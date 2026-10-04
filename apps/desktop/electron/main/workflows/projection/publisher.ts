/**
 * [INPUT]: Depends on the shared account-scope admission, the cloud transport (workflows runs/attention/bindings publish), the purpose-12/13 codec and run projection, and a source of this computer's runs, bindings, needs-you items, workflow Chats and configuration names.
 * [OUTPUT]: Provides WorkflowProjectionPublisher (the Workflow outbox) and WorkflowProjectionSource: a Project deleted or removed from this computer — or one the workflow runtime remembers removing — is cleared from the account (its runs, bindings and needs-you items) and then acknowledged, looked for again once a minute; each run is written under its ledger revision — a state change at once, anything else at most once a second — and a restart writes only what the server lacks; this computer's attention row is rewritten only when its items move, naming one push per new item and reminder; each binding projection carries its configuration names and is rewritten when they change. Nothing leaves while the account is not admitted.
 * [POS]: workflows' cloud side (P13 §10.2 / §10.2a). The ledger stays the truth and works signed out; this only mirrors it for phones and Web, which never write here.
 */
import { randomUUID } from "node:crypto";
import { canonicalJson } from "@ai-chat/cloud-protocol";
import { BINDING_REASONS } from "@ai-chat/cloud-protocol/contracts/base/binding";
import type { WorkflowBinding } from "@ai-chat/cloud-protocol/contracts/workflow/binding";
import type { NeedsYouItem } from "@ai-chat/cloud-protocol/contracts/workflow/bridge";
import type { WorkflowRoleName } from "@ai-chat/cloud-protocol/contracts/workflow/recipe";
import type { WorkflowRun } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import { projectWorkflowRun, sealWorkflowAttention, sealWorkflowBinding, sealWorkflowRun } from "@ai-chat/cloud-protocol/workflows/encrypted";
import { WORKFLOW_PROJECTION_LIMITS, type ProjectedNeedsYouItem, type WorkflowAttentionPush, type WorkflowProjectionReceipt } from "@ai-chat/cloud-protocol/workflows/model";
import type { AccountTransport } from "../../cloud/runtime/transport/transport";
import type { CloudAccountService } from "../../cloud/runtime/service";
import { accountScopeAdmission, type AdmissionPorts, type Admitted } from "../../cloud/sync/account-config/admission";

export type WorkflowProjectionSource = {
  runs(): readonly WorkflowRun[];
  bindings(): readonly WorkflowBinding[];
  needsYou(): readonly NeedsYouItem[];
  chatFor(runId: string, role: WorkflowRoleName): string | null;
  configName(configId: string): string | null;
  /** False once a Project is deleted or removed from this computer (archived Projects still exist: their runs are only paused). */
  projectExists(projectId: string): boolean;
  /** Projects removed here whose bindings are already gone; acknowledged once the account's copy is cleared. */
  removedProjects(): readonly string[];
  acknowledgeRemoved(projectId: string): Promise<void>;
  onChanged(listener: () => void): () => void;
};
export type WorkflowProjectionPorts = AdmissionPorts & {
  account: AdmissionPorts["account"] & Pick<CloudAccountService, "subscribeIdentity" | "subscribeConnection">;
  transport: Pick<AccountTransport, "mutate">;
  source: WorkflowProjectionSource;
  own?(activity: { close(): Promise<void> }): () => void;
  report?(error: unknown): void;
  now?(): number;
  timer?(run: () => void, ms: number): () => void;
  retryMs?: { first: number; max: number };
};
const ROLES: readonly WorkflowRoleName[] = ["plan", "develop", "review"];
const CAS_ROUNDS = 3;
/* Nothing announces a Project's removal to the workflow runtime, so an admitted publisher also looks again once a minute; a
   pass with nothing new writes nothing. */
const RECHECK_MS = 60_000;
class Superseded extends Error { constructor() { super("workflow-projection-superseded"); } }
const defaultTimer = (run: () => void, ms: number) => { const handle = setTimeout(run, ms); handle.unref?.(); return () => clearTimeout(handle); };

/** What pushes a needs-you item names: a confirmation once per reminder it has reached, anything else once. */
function pushesFor(item: ProjectedNeedsYouItem, run: WorkflowRun | undefined): WorkflowAttentionPush[] {
  const itemId = `${item.runId}.${item.kind}.${item.since}`;
  if (item.kind === "confirm-plan" || item.kind === "confirm-result") {
    const pending = run?.confirmations.find(entry => !entry.decision && entry.expiredAt === null);
    if (!pending) return [];
    return (pending.reminders.length ? pending.reminders : ["started" as const])
      .map(reminder => ({ itemId, reminder, target: { targetKind: "confirmation" as const, runId: item.runId, stepId: pending.stepId } }));
  }
  const stepId = run?.steps.find(step => step.state === "running")?.stepId;
  if (item.kind === "agent-waiting" && item.role && item.chatId && stepId)
    return [{ itemId, reminder: null, target: { targetKind: "agent-waiting", runId: item.runId, stepId, role: item.role, chatId: item.chatId } }];
  return [{ itemId, reminder: null, target: { targetKind: "needs-you" } }];
}
const pushKey = (push: WorkflowAttentionPush) => `${push.itemId}:${push.reminder ?? "once"}`;

export class WorkflowProjectionPublisher {
  private key = "";
  private generation = 0;
  /* In memory only: a restart starts empty, and the server's answer (conflicted at a revision it has) fills it back in. */
  private runs = new Map<string, { revision: number; state: string; at: number }>();
  private attention = { revision: null as number | null, digest: null as string | null, pushed: new Set<string>() };
  private bindings = new Map<string, { revision: number | null; digest: string | null }>();
  private purged = new Set<string>();
  private cancelRecheck: (() => void) | null = null;
  private flight: Promise<void> | null = null;
  private again = false;
  private closed = false;
  private failures = 0;
  private cancelDue: (() => void) | null = null;
  private cancelRetry: (() => void) | null = null;
  private scoped: (() => void) | null = null;
  private readonly releases: (() => void)[] = [];
  private readonly now: () => number;
  private readonly timer: (run: () => void, ms: number) => () => void;
  constructor(private readonly ports: WorkflowProjectionPorts) {
    this.now = ports.now ?? Date.now;
    this.timer = ports.timer ?? defaultTimer;
    const wake = () => this.wake();
    this.releases.push(ports.account.subscribeIdentity(wake), ports.account.subscribeConnection(wake), ports.source.onChanged(wake));
    wake();
  }
  wake() {
    if (this.closed) return;
    if (this.flight) { this.again = true; return; }
    const flight = (async () => { do { this.again = false; await this.pass(); } while (this.again && !this.closed); })()
      .finally(() => { if (this.flight === flight) this.flight = null; });
    this.flight = flight;
  }
  /** Settles once no pass is running or queued. */
  async idle() { while (this.flight) await this.flight.catch(() => undefined); }
  async close() {
    this.closed = true; this.stop();
    for (const release of this.releases.splice(0)) release();
    await this.flight?.catch(() => undefined);
  }

  private stop() {
    this.cancelDue?.(); this.cancelDue = null; this.cancelRetry?.(); this.cancelRetry = null; this.cancelRecheck?.(); this.cancelRecheck = null;
    this.scoped?.(); this.scoped = null;
  }
  private async pass() {
    const admission = accountScopeAdmission(this.ports);
    if (admission.kind !== "admitted") { this.stop(); this.key = ""; return; }
    if (admission.key !== this.key) {
      // Another account, space or connection: nothing known about the old one says anything about this one.
      this.stop(); this.key = admission.key; this.generation++;
      this.runs = new Map(); this.bindings = new Map(); this.purged = new Set(); this.attention = { revision: null, digest: null, pushed: new Set() };
      this.scoped = this.ports.own?.({ close: async () => { this.stop(); await this.flight?.catch(() => undefined); } }) ?? null;
    }
    const generation = this.generation;
    const current = () => { if (this.closed || generation !== this.generation) throw new Superseded(); };
    this.cancelRecheck?.();
    this.cancelRecheck = this.timer(() => { this.cancelRecheck = null; this.wake(); }, RECHECK_MS);
    try {
      await this.purgeRemovedProjects(admission, current);
      await this.publishRuns(admission, current);
      await this.publishAttention(admission, current);
      await this.publishBindings(admission, current);
      this.failures = 0;
    } catch (error) {
      if (error instanceof Superseded) return;
      this.ports.report?.(error);
      const { first, max } = this.ports.retryMs ?? { first: 2_000, max: 60_000 };
      this.cancelRetry?.();
      this.cancelRetry = this.timer(() => { this.cancelRetry = null; this.wake(); }, Math.min(max, first * 2 ** this.failures++));
    }
  }

  private async publishRuns(admission: Admitted, current: () => void) {
    const { source, deviceId } = this.ports;
    const bindings = new Map(source.bindings().map(binding => [binding.bindingId, binding]));
    let due: number | null = null;
    for (const run of source.runs()) {
      const binding = bindings.get(run.bindingId);
      if (!binding || !source.projectExists(binding.projectId)) continue;
      // The ledger revision orders the writes: the server keeps only a newer one, so coalescing never needs a counter of its own.
      const revision = run.revision + 1, last = this.runs.get(run.runId), now = this.now();
      if (last && last.revision >= revision) continue;
      if (last && last.state === run.state && now - last.at < WORKFLOW_PROJECTION_LIMITS.runWriteIntervalMs) {
        due = Math.min(due ?? Infinity, last.at + WORKFLOW_PROJECTION_LIMITS.runWriteIntervalMs);
        continue;
      }
      const chats = Object.fromEntries(ROLES.flatMap(role => { const chatId = source.chatFor(run.runId, role); return chatId ? [[role, chatId]] : []; }));
      const record = await sealWorkflowRun({ runId: run.runId, ownerDeviceId: deviceId, projectId: binding.projectId, baseId: run.record.base.ownerInstanceId,
        rowId: run.record.rowId, revision, operationId: `${run.runId}.${revision}`, run: projectWorkflowRun(run, { chats }) }, admission.crypto);
      current();
      const receipt = await this.ports.transport.mutate("workflows/runs:publish", { ...admission.header, record });
      current();
      this.runs.set(run.runId, { revision: receipt.status === "applied" ? revision : Math.max(revision, receipt.current?.revision ?? 0), state: run.state, at: now });
    }
    this.cancelDue?.(); this.cancelDue = null;
    if (due !== null) this.cancelDue = this.timer(() => { this.cancelDue = null; this.wake(); }, Math.max(0, due - this.now()));
  }

  private async publishAttention(admission: Admitted, current: () => void) {
    const { source, deviceId } = this.ports;
    const runs = new Map(source.runs().map(run => [run.runId, run]));
    // A waiting Agent is shown only with the Chat a phone opens; without one there is nothing it could do.
    const items = source.needsYou().flatMap((item): ProjectedNeedsYouItem[] => {
      if (!source.projectExists(item.projectId)) return [];
      const { role, ...rest } = item;
      if (item.kind !== "agent-waiting") return [rest];
      const chatId = role ? source.chatFor(item.runId, role) : null;
      return role && chatId ? [{ ...rest, role, chatId }] : [];
    }).sort((a, b) => b.since - a.since);
    const page = items.slice(0, WORKFLOW_PROJECTION_LIMITS.attentionItems), pendingCount = Math.min(items.length, WORKFLOW_PROJECTION_LIMITS.pendingCount);
    const digest = canonicalJson({ page, pendingCount });
    const pushes = items.flatMap(item => pushesFor(item, runs.get(item.runId))).filter(push => !this.attention.pushed.has(pushKey(push)));
    if (digest === this.attention.digest && !pushes.length) return;
    // One push per write: each new item or reminder is its own write of the same page.
    for (const push of pushes.length ? pushes : [null]) {
      await this.cas(async revision => {
        const record = await sealWorkflowAttention({ ownerDeviceId: deviceId, revision, operationId: randomUUID(), items: page, pendingCount }, admission.crypto);
        current();
        return this.ports.transport.mutate("workflows/attention:publish", { ...admission.header, record, attention: push });
      }, this.attention, current);
      if (push) this.attention.pushed.add(pushKey(push));
    }
    this.attention.digest = digest;
  }

  private async publishBindings(admission: Admitted, current: () => void) {
    const { source, deviceId } = this.ports;
    for (const binding of source.bindings()) {
      if (!source.projectExists(binding.projectId)) continue;
      const reason = binding.suspendedReason;
      if (reason !== null && !(BINDING_REASONS as readonly string[]).includes(reason)) { this.ports.report?.(new Error(`workflow-binding-reason:${reason}`)); continue; }
      const roles = Object.fromEntries(ROLES.map(role => [role, { configId: binding.roles[role].configId,
        configName: (source.configName(binding.roles[role].configId) ?? "").slice(0, 120) }])) as Record<WorkflowRoleName, { configId: string; configName: string }>;
      const projection = { bindingId: binding.bindingId, projectId: binding.projectId, baseId: binding.base.base.ownerInstanceId, state: binding.state,
        suspendedReason: reason as (typeof BINDING_REASONS)[number] | null, recipe: binding.recipe, roles, taskNameColumnId: binding.base.taskNameColumnId,
        stageColumnId: binding.base.stageColumnId, acceptanceCriteriaColumnId: binding.base.acceptanceCriteriaColumnId };
      const digest = canonicalJson(projection), known = this.bindings.get(binding.bindingId) ?? { revision: null, digest: null };
      if (known.digest === digest) continue;
      await this.cas(async revision => {
        const record = await sealWorkflowBinding({ ownerDeviceId: deviceId, revision, operationId: randomUUID(), binding: projection }, admission.crypto);
        current();
        return this.ports.transport.mutate("workflows/bindings:publish", { ...admission.header, record });
      }, known, current);
      this.bindings.set(binding.bindingId, { revision: known.revision, digest });
    }
  }

  /** A Project this computer no longer has: its runs and bindings leave the account too, once per session (idempotent on the server). */
  private async purgeRemovedProjects(admission: Admitted, current: () => void) {
    const { source } = this.ports;
    const removed = new Set(source.removedProjects());
    const referenced = new Set([...source.bindings().map(binding => binding.projectId), ...removed]);
    for (const projectId of referenced) {
      if (!removed.has(projectId) && (source.projectExists(projectId) || this.purged.has(projectId))) continue;
      for (;;) {
        const result = await this.ports.transport.mutate("workflows/projects:remove", { ...admission.header, projectId });
        current();
        if (result.complete) break;
      }
      this.purged.add(projectId);
      if (removed.has(projectId)) await source.acknowledgeRemoved(projectId);
    }
  }

  /** Writes at the next revision; a conflict (a restart forgot it, or another write landed) adopts the server's and writes again. */
  private async cas(write: (revision: number) => Promise<WorkflowProjectionReceipt>, state: { revision: number | null }, current: () => void) {
    for (let round = 0; round < CAS_ROUNDS; round++) {
      const revision = (state.revision ?? 0) + 1, receipt = await write(revision);
      current();
      if (receipt.status === "applied") { state.revision = revision; return; }
      state.revision = receipt.current?.revision ?? 0;
    }
    throw new Error("workflow-projection-conflict");
  }
}
