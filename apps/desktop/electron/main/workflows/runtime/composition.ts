/**
 * [INPUT]: Depends on the workflow binding store, run ledger, executor, evidence store, step-result intake, Base action ports, the Chat registry (loaded by the foundation) and dispatch, the built-in recipe, role admission over this computer's measurements, and host ports (coordinator, Chats, Projects, Bases, turn defaults, the verified operator, plugin state).
 * [OUTPUT]: Provides composeWorkflowRuntime (installing the result for workflowRuntime() in installed.ts): the composed runtime (the service behind window.workflows — enable a workflow, bindings, runs, start, confirm with the host operator, pause, resume, cancel, force stop, check result, retry a blocked step, preflight (E-03), rework, chatFor, projectRunCount, projectExists, confirmAs (a remote sender's verified operator), removeProject (a Project deleted or removed; archive and restore are followed from the Project's archivedAt, any writer, D3-02: an unanswered confirmation withdrawn, A2-03, the archive's pause restated as project-restored, V-02; archived Projects refuse new execution and leave the needs-you list), needsYou (including an Agent waiting on the person in a hidden workflow Chat; each item named by its record's task as it reads now) — plus turnSettled for the Chat machinery, onChanged, pauseForProvider and close); bindings are reconciled against every Base change, local or synced, and once at start. providerReadiness is awaited (E2-04). Role admission (the executor's and setup's preflight) shares one port set, and a partial apply (T21-c) is reported on the configuration by both.
 * defaults chooses the first admitted preferred Provider and verifies saved roles still use it; enable rechecks Project/Base ownership and role admission.
 * [POS]: The one place TASK-17's parts meet the running app (2.6). Everything durable lives under `<userData>/workflows`; runs execute only on this computer, the one that holds the Project.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { MeasuredCapability, MeasurementIdentity } from "@ai-chat/cloud-protocol/contracts/provider";
import { resolveBinding } from "@ai-chat/cloud-protocol/contracts/base/binding";
import type { BaseRef } from "@ai-chat/cloud-protocol/contracts/resources";
import type { EnableWorkflowInput, NeedsYouItem, WorkflowRecordRef } from "@ai-chat/cloud-protocol/contracts/workflow/bridge";
import { PLAN_DEVELOP_REVIEW } from "@ai-chat/cloud-protocol/contracts/workflow/builtin";
import type { WorkflowRoleName } from "@ai-chat/cloud-protocol/contracts/workflow/recipe";
import type { FreshRead } from "@ai-chat/cloud-protocol/contracts/workflow/rework";
import type { ConfirmInput, VerifiedOperator, WorkflowRun } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import type { AgentBackendId, AgentTurnOptions } from "../../../../shared/ipc/agent/agent-ipc";
import type { ManualTurnReceipt, TrustedManualTurnSubmission } from "../../../../shared/ipc/content/sections-ipc";
import type { BaseStore } from "../../bases/base-store";
import type { ProjectStore } from "../../projects/store/project-store";
import type { BasesService } from "../../bases/bases-service";
import type { RunResultStore } from "../../bases/public/results";
import { enableWorkflowColumns } from "../../bases/public/workflow-columns";
import { createBaseActionPorts, runBaseAction } from "../base-actions";
import { WorkflowBindingStore } from "../bindings";
import { EvidenceStore, type CommandEvidence } from "../evidence";
import { WorkflowExecutor, type AgentDispatch, type SettledTurn } from "../executor";
import { WorkflowRunLedger } from "../ledger";
import { installStepResultIntake, StepResultIntake } from "../step-results";
import type { WorkflowChatRegistry } from "./chats";
import { workflowCommandExits } from "../turn-policy";
import { createAgentDispatch, type DispatchPorts } from "./turn/dispatch";
import { admitFrozen, appliedScopeDifferences, preflightRoles, turnOptionsFor, type FrozenLike, type ProviderReadiness } from "./turn/effective-config";
import type { ConfigApplySetting } from "@ai-chat/cloud-protocol/contracts/workflow/bridge";
import { confirmationNotice, workflowChatTitle } from "./surface/titles";
import { createFormatExtractor } from "./format-extractor";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { installWorkflowRuntime } from "./installed";
import { readWorkflowEvidence } from "./surface/evidence";
import { WorkspaceLeases } from "./workspace-leases";
import { hostEnforcedFor } from "../../agent-configs/runtime";
import { assertProjectOpen, followProjectArchive, removeOrphanedProjectWorkflows, removeProjectWorkflows } from "./project-lifecycle";
import type { AgentConfigService } from "../../agent-configs/service";
import type { WorkflowDefaults, WorkflowRolePreflight } from "@ai-chat/cloud-protocol/contracts/workflow/bridge";

export type WorkflowRuntimeInput = {
  userData: string;
  /** Loaded and owned by the foundation: Chat lists ask it before this runtime exists. */
  chatRegistry: WorkflowChatRegistry;
  /** Live turns: the Chats whose Agent is waiting on the person (an open permission request or question), and a signal when that changes. */
  turns: { waitingChatIds(): ReadonlySet<string>; onInteraction(listener: (chatId: string) => void): () => void;
    /** Kills one live turn's whole process tree and confirms it gone (Force stop); verifyGroup checks a group left unconfirmed. */
    forceKill: AgentDispatch["forceKill"]; verifyGroup: AgentDispatch["verifyGroup"];
    /** What still holds a request's process: the live turn by its launch identity, else custody's recoverable entry, else none. */
    processOf: AgentDispatch["processOf"] };
  coordinator: { submitManualTurn(submission: TrustedManualTurnSubmission): Promise<ManualTurnReceipt>; cancelManualTurn(requestId: string): Promise<unknown> };
  chats: { getIncarnationId(chatId: string): string | null | undefined; getMetadata(chatId: string): ReturnType<DispatchPorts["chatFacts"]> | undefined;
    patchOptions: DispatchPorts["patchOptions"] };
  projects: Pick<ProjectStore, "get" | "resolveWorkspace" | "onArchivedChange">;
  bases: { store: BaseStore; service: BasesService; results: RunResultStore };
  turnDefaults(backend: AgentBackendId): AgentTurnOptions;
  validateTurnOptions(backend: AgentBackendId, options: AgentTurnOptions): AgentTurnOptions;
  isBackend(id: string): id is AgentBackendId;
  freezeConfig(configId: string, role?: WorkflowRoleName, projectId?: string): { ok: true; frozen: unknown } | { ok: false; reason: string };
  providerPreferences?(): { defaultBackend: string; providerOrder: readonly string[] };
  defaultConfigurations?(provider: string, persist: boolean, projectId: string): ReturnType<AgentConfigService["workflowDefaults"]>;
  measurements(providerId: string): Promise<{ measured: MeasuredCapability[]; identity: MeasurementIdentity | null }>;
  /** T21-c: a configuration's explicit settings this computer's runtime of the Provider cannot apply. */
  unapplied?(providerId: string, fields: Record<string, { mode?: string; value?: unknown }>, workspace: string | null): Promise<readonly ConfigApplySetting[]>;
  /** T21-c: records on a configuration whether the frozen version's settings apply here (null: all of them); R03: the verdict names
      the frozen version it judged, never whichever version is current when it arrives. */
  reportApply?(frozen: unknown, settings: readonly ConfigApplySetting[] | null): void;
  workflowEnabled(): boolean;
  /** What the Workflow plugin waits for (the plugin resolver), or null when it can start runs. */
  workflowBlockedBy?(): readonly { contract: string; reason: string }[] | null;
  operator(): VerifiedOperator;
  /** Whether the Provider can run at all here: its plugin on, its CLI installed, signed in (unknown counts as ready; admission measures). */
  providerReadiness(providerId: string): Promise<ProviderReadiness>;
  /** Shows a desktop notification; `open` runs when the person clicks it (it only shows the confirmation, never decides). */
  showNotification(notice: { title: string; body: string }, open: () => void): void;
  /** Wake from sleep: the confirmation clock checks the wall clock once (Q16). */
  onWake(listener: () => void): () => void;
  /** The interface language, for the fixed titles of workflow Chats. */
  locale(): AppLocale;

  now(): number;
};
export type WorkflowRuntime = Awaited<ReturnType<typeof composeWorkflowRuntime>>;

/** The commands a turn really ran, from its recorded `command` tool parts; exit codes are not recorded by the Chat parts (W16). */
/**
 * The commands a turn really ran, from its recorded `command` tool parts, each with the exact exit code the Provider reported
 * for it (TASK-18; Codex reports one, Claude's adapter does not) or null, and the tool's own completed/failed status.
 */
export function commandsFromParts(parts: readonly unknown[] | undefined, exits: ReadonlyMap<string, number> = new Map()): CommandEvidence[] | null {
  if (!parts) return null;
  return parts.flatMap(part => {
    const tool = part as { type?: string; itemId?: string; tool?: string; title?: string; detail?: string; status?: string };
    if (tool.type !== "tool" || tool.tool !== "command" || !tool.title) return [];
    return [{ command: tool.title.slice(0, 500), exitCode: tool.itemId ? exits.get(tool.itemId) ?? null : null,
      status: tool.status === "failed" ? "failed" as const : "completed" as const, outputTail: (tool.detail ?? "").slice(-1500) }];
  });
}

export async function composeWorkflowRuntime(input: WorkflowRuntimeInput) {
  const root = join(input.userData, "workflows");
  const registry = input.chatRegistry, bindings = new WorkflowBindingStore(root), evidence = new EvidenceStore(join(root, "evidence"));
  /* Role admission as setup's preflight and the executor both ask it (04 §5, RSH-07 host enforcement, T21-c partial apply). */
  const admissionPorts = { readiness: input.providerReadiness, measurements: input.measurements, hostEnforced: hostEnforcedFor,
    ...(input.unapplied ? { unapplied: input.unapplied } : {}) };
  const ledger = new WorkflowRunLedger(root, bindings, { now: input.now, newId: () => randomUUID(), freezeConfig: input.freezeConfig,
    recipe: (recipeId, version) => recipeId === PLAN_DEVELOP_REVIEW.recipeId && version === PLAN_DEVELOP_REVIEW.version ? PLAN_DEVELOP_REVIEW : null });
  const leases = new WorkspaceLeases(root);
  await bindings.initialize(); await ledger.initialize(); await leases.initialize();
  const intake = new StepResultIntake(ledger);
  installStepResultIntake(intake);
  const listeners = new Set<(event: { runId?: string; bindingId?: string }) => void>();
  /* The confirmation clock re-plans its one timer after every change (a new confirmation starts its own clock). */
  let clockReady = false;
  const opens = new Set<(target: { runId: string; stepId: string }) => void>();
  const changed = (event: { runId?: string; bindingId?: string }) => { for (const listener of listeners) listener(event); if (clockReady) scheduleClock(); };
  const base = createBaseActionPorts(input.bases);
  const bindingOf = (runId: string) => { const run = ledger.get(runId); return run ? bindings.get(run.bindingId) : null; };
  const executor = new WorkflowExecutor({ ledger, bindings, base, intake, evidence, leases, workflowEnabled: () => input.workflowEnabled(),
    agent: createAgentDispatch({ submit: submission => input.coordinator.submitManualTurn(submission), cancel: requestId => input.coordinator.cancelManualTurn(requestId), forceKill: requestId => input.turns.forceKill(requestId), verifyGroup: group => input.turns.verifyGroup(group),
      processOf: requestId => input.turns.processOf(requestId),
      incarnationOf: chatId => input.chats.getIncarnationId(chatId) ?? null, registry, now: input.now,
      chatFacts: chatId => input.chats.getMetadata(chatId) ?? null, patchOptions: patch => input.chats.patchOptions(patch),
      chatTitle: (role, task) => workflowChatTitle(input.locale(), role, task), isBackend: input.isBackend,
      workspaceFor: runId => {
        const project = input.projects.get(bindingOf(runId)?.projectId ?? "");
        return project && project.workspaceBinding.kind !== "none" ? { kind: "project", projectId: project.id, membershipRevision: project.membershipRevision } : null;
      },
      turnOptionsFor: (backend, fields) => input.validateTurnOptions(backend, turnOptionsFor(backend, fields, input.turnDefaults(backend))) }),
    /* Admission (04 §5): requested guarantees, then readiness and this computer's measurements, probing on demand for a Provider that has none yet. */
    /* T21-c: the executor's admission also records a partial apply on the configuration, so its row says so. */
    admit: async (role, config, workspace) => {
      const admitted = await admitFrozen(role, config as never, admissionPorts, { workspace });
      input.reportApply?.(config, [...new Set([...(!admitted.admitted ? admitted.settings ?? [] : []), ...appliedScopeDifferences(config as FrozenLike)])]);
      return admitted;
    },
    formatExtractor: createFormatExtractor({ readiness: input.providerReadiness, measurements: input.measurements }),
    notify: ({ runId, stepId, reminder }) => {
      const run = ledger.get(runId), step = run?.recipe.steps.find(item => item.id === stepId);
      const confirmation = step?.kind === "human.confirm" ? step.confirmation : "plan";
      void confirmationNotice(input.locale(), confirmation, reminder)
        .then(notice => input.showNotification(notice, () => { for (const listener of opens) listener({ runId, stepId }); }))
        .catch(cause => console.warn("[workflows] confirmation reminder not shown", cause));
    },
    chatOf: (record, role) => registry.get(record, role)?.chatId ?? null,
    newRequestId: () => randomUUID(), workspaceOf: run => {
      const project = input.projects.get(bindings.get(run.bindingId)?.projectId ?? "");
      return project && project.workspaceBinding.kind !== "none" ? input.projects.resolveWorkspace(project.workspaceBinding) ?? null : null;
    } });
  /* A-04: with the Workflow plugin off nothing new starts or goes on: no run, rework, resume, retry or check. */
  /* 2-design §115: an archived Project starts, resumes, retries or confirms nothing; its runs were paused when it was archived. */
  const archived = (projectId: string | null | undefined) => Boolean(projectId && input.projects.get(projectId)?.archivedAt);
  const gate = (projectId?: string | null) => {
    if (!input.workflowEnabled()) throw new Error("workflow-plugin-disabled");
    /* Appendix C.2: on but waiting for a dependency (no usable Provider) is refused at admission, named as contract-missing. */
    if (input.workflowBlockedBy?.()?.length) throw new Error("contract-missing");
    assertProjectOpen(() => archived(projectId));
  };
  const after = async (run: Promise<{ run: WorkflowRun } | WorkflowRun>) => { const value = await run; const next = "run" in value ? value.run : value; changed({ runId: next.runId }); return next; };
  const freshRead = async (runId: string): Promise<FreshRead> => {
    const run = ledger.get(runId), binding = bindingOf(runId);
    if (!run || !binding) throw new Error("workflow-run-not-found");
    const read = run.recipe.steps.find(step => step.kind === "app.call" && step.action === "base.read");
    if (read?.kind !== "app.call") throw new Error("workflow-recipe-unavailable");
    return await runBaseAction({ step: read, args: {}, binding: binding.base, recipe: run.recipe, rowId: run.record.rowId, principal: null, ports: base }) as FreshRead;
  };
  const baseFacts = (ownerKey: BaseRef["ownerKey"]) => {
    const live = input.bases.store.peek(ownerKey);
    return { ref: { ownerKey, ownerInstanceId: live?.meta.ownerInstanceId ?? "" }, columns: live?.meta.columns ?? [] };
  };
  /* A bound Base that no longer matches an enabled binding (a bound column removed or retyped, the Base replaced or removed —
     locally or by sync) suspends it with the reason, and Q2 pauses its runs after their current step. */
  const reconcileBase = async (ownerKey?: string) => {
    for (const binding of bindings.list()) {
      if (binding.state !== "enabled" || (ownerKey !== undefined && binding.base.base.ownerKey !== ownerKey)) continue;
      const facts = baseFacts(binding.base.base.ownerKey);
      if (resolveBinding(binding.base, facts).state !== "suspended") continue;
      const next = await bindings.reconcile(binding.bindingId, facts);
      if (next?.state !== "suspended" || next.revision === binding.revision) continue;
      await executor.suspendBinding(next.bindingId, next.suspendedReason ?? "binding-suspended");
      changed({ bindingId: next.bindingId });
    }
  };
  /* One reconcile at a time, so a burst of changes to one Base suspends its binding (and pauses its runs) once. */
  let reconciling = Promise.resolve();
  const queueReconcile = (ownerKey?: string) => (reconciling = reconciling.then(() => reconcileBase(ownerKey))
    .catch(cause => console.warn("[workflows] binding reconcile failed", cause)));
  const releaseBaseEvents = input.bases.service.onBaseEvent(event => {
    if (event.type === "base-changed" || event.type === "removed") void queueReconcile(event.ownerKey);
  });
  /* Changes made while this runtime was not loaded (or the app was closed) never produced an event here. */
  await queueReconcile();
  /* A cancel a restart left pending (unconfirmed or ordinary) is settled only on positive evidence: recorded groups, or custody. */
  await executor.recoverCancellations();
  /* A-07: a writer lease a previous launch left stays only while custody still holds its writer; runs queued behind it go on. */
  await executor.recoverWorkspaceLeases();
  /* The confirmation clock (Q16): the ledger is its only truth; this timer just wakes it at the next due moment, and startup
     and wake from sleep check the wall clock once. */
  let clockTimer: NodeJS.Timeout | undefined;
  let clocking = Promise.resolve();
  const scheduleClock = () => {
    clearTimeout(clockTimer);
    const due = executor.nextConfirmationDue(input.now());
    if (due === null) return;
    clockTimer = setTimeout(() => void checkClock(), Math.min(Math.max(0, due - input.now()), 2 ** 31 - 1));
    clockTimer.unref?.();
  };
  const checkClock = () => (clocking = clocking.then(async () => { await executor.checkConfirmationClock(input.now()); for (const listener of listeners) listener({}); })
    .catch(cause => console.warn("[workflows] confirmation clock check failed", cause)).finally(scheduleClock));
  clockReady = true;
  const releaseWake = input.onWake(() => void checkClock());
  await checkClock();
  /* A permission request in a hidden workflow Chat must reach the needs-you list, or the run waits unseen. */
  const releaseInteractions = input.turns.onInteraction(chatId => { if (registry.roleOf(chatId)) changed({}); });
  const sameRecord = (run: WorkflowRun, record: WorkflowRecordRef) => run.record.rowId === record.rowId && run.record.base.ownerKey === record.base.ownerKey
    && run.record.base.ownerInstanceId === record.base.ownerInstanceId;

  const runtime = {
    ledger, bindingStore: bindings, registry, executor,
    /** A reminder was clicked: show that confirmation in its run's details (it decides nothing). */
    onOpenConfirmation(listener: (target: { runId: string; stepId: string }) => void) { opens.add(listener); return () => { opens.delete(listener); }; },
    onChanged(listener: (event: { runId?: string; bindingId?: string }) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async enableWorkflow(request: EnableWorkflowInput) {
      gate(request.projectId);
      const project = input.projects.get(request.projectId);
      if (!project || project.workspaceBinding.kind === "none") throw new Error("workflow-project-unavailable");
      const current = await input.bases.service.get(request.base.ownerKey);
      if (request.base.ownerKey !== `project:${request.projectId}` || current?.meta.ownerInstanceId !== request.base.ownerInstanceId
        || !current.meta.columns.some(column => column.id === request.taskNameColumnId)) throw new Error("workflow-binding-not-found");
      const answers = await runtime.preflight(Object.fromEntries(Object.entries(request.roles).map(([role, value]) => [role, value.configId])), request.projectId);
      if (Object.values(answers).some(answer => !answer.ready)) throw new Error("workflow-role-not-admitted");
      const ids = await enableWorkflowColumns(input.bases.service, request.base.ownerKey, request.columnNames, request.stageLabels.map(stage => ({ ...stage })));
      const bindingId = `${request.projectId}:${request.base.ownerKey}:${request.base.ownerInstanceId}`.slice(0, 128);
      const existing = bindings.get(bindingId);
      await bindings.save({ bindingId, projectId: request.projectId, recipe: { recipeId: PLAN_DEVELOP_REVIEW.recipeId, version: PLAN_DEVELOP_REVIEW.version },
        base: { base: request.base, taskNameColumnId: request.taskNameColumnId, ...ids }, roles: request.roles, ownerDeviceId: input.operator().deviceId },
        existing?.revision ?? null);
      const enabled = await bindings.setEnabled(bindingId, true, baseFacts(request.base.ownerKey));
      changed({ bindingId });
      return enabled;
    },
    bindings: (projectId?: string) => bindings.list().filter(binding => !projectId || binding.projectId === projectId),
    async defaults(projectId: string): Promise<WorkflowDefaults> {
      gate(projectId);
      const project = input.projects.get(projectId);
      if (!project || project.workspaceBinding.kind === "none") throw new Error("workflow-project-unavailable");
      const workspace = input.projects.resolveWorkspace(project.workspaceBinding) ?? null;
      const preferences = input.providerPreferences?.();
      const order = [...new Set([preferences?.defaultBackend, ...(preferences?.providerOrder ?? [])].filter((id): id is string => Boolean(id)))];
      const problems: WorkflowRolePreflight[] = [];
      for (const provider of order) {
        if (!input.isBackend(provider) || !input.defaultConfigurations) continue;
        const candidates = await input.defaultConfigurations(provider, false, projectId);
        let qualified = true;
        for (const candidate of candidates) {
          const result = candidate.result;
          if (!result.ok) {
            problems.push({ ready: false, refusal: result.reason, provider, guarantee: null }); qualified = false; break;
          }
          const admitted = await admitFrozen(candidate.role, result.frozen, admissionPorts, { workspace });
          if (!admitted.admitted) {
            problems.push({ ready: false, refusal: admitted.reason as Extract<WorkflowRolePreflight, { ready: false }>["refusal"],
              provider, guarantee: admitted.guarantee ?? null, settings: admitted.settings });
            qualified = false; break;
          }
        }
        if (!qualified) continue;
        const saved = await input.defaultConfigurations(provider, true, projectId);
        const roles = Object.fromEntries(saved.map(value => [value.role, { configId: value.configId }])) as EnableWorkflowInput["roles"];
        const check = await runtime.preflight(Object.fromEntries(saved.map(value => [value.role, value.configId])), projectId);
        const consistent = saved.every(value => {
          const current = input.freezeConfig(value.configId, value.role, projectId);
          return current.ok && (current.frozen as FrozenLike).resolved?.provider === provider;
        });
        if (!consistent) { problems.push({ ready: false, refusal: "config-unavailable", provider, guarantee: null }); continue; }
        if (Object.values(check).every(answer => answer.ready)) return { ready: true, provider, roles };
        problems.push(...Object.values(check).filter(answer => !answer.ready));
      }
      return { ready: false, problems };
    },
    async setBindingEnabled(bindingId: string, enabled: boolean) {
      const binding = bindings.get(bindingId);
      if (!binding) throw new Error("workflow-binding-not-found");
      const next = await bindings.setEnabled(bindingId, enabled, baseFacts(binding.base.base.ownerKey));
      changed({ bindingId });
      return next;
    },
    runsForRecord: (record: WorkflowRecordRef) => ledger.list().filter(run => sameRecord(run, record)),
    run: (runId: string) => ledger.get(runId),
    async start(request: { bindingId: string; rowId: string }) {
      gate(bindings.get(request.bindingId)?.projectId);
      const started = await ledger.start({ ...request, inputs: {} });
      changed({ runId: started.run.runId });
      if (started.started) void executor.advance(started.run.runId).then(() => changed({ runId: started.run.runId }));
      return started;
    },
    /* A-02: against the record as it is now; a changed task or criteria asks again and answers stale-proposal. */
    async confirm(runId: string, stepId: string, request: ConfirmInput) { return runtime.confirmAs(runId, stepId, request, input.operator()); },
    /** A confirmation sent from another device (P13 R-24): the operator is the account and the device the server verified as sender. */
    async confirmAs(runId: string, stepId: string, request: ConfirmInput, operator: VerifiedOperator) {
      assertProjectOpen(() => archived(bindingOf(runId)?.projectId));
      try { await executor.confirm(runId, stepId, request, operator); } finally { changed({ runId }); }
      return ledger.get(runId)!;
    },
    pause: (runId: string) => after(ledger.pause(runId)),
    async resume(runId: string) {
      gate(bindingOf(runId)?.projectId);
      const binding = bindingOf(runId);
      if (!binding || binding.state !== "enabled") throw new Error("workflow-binding-not-enabled");
      const next = await after(ledger.resume(runId));
      await executor.advance(runId); changed({ runId });
      return ledger.get(runId) ?? next;
    },
    async cancel(runId: string) { await executor.cancel(runId); changed({ runId }); return ledger.get(runId)!; },
    /* Q20: only after a cancel that did not settle; the turn was already asked to stop, the record ends cancelled with forcedStop. */
    forceStop: (runId: string) => after(executor.forceStop(runId)),
    /* Q8: an unknown outcome is not re-sent. Checking asks the run to go on only once the person has looked (a new attempt of the blocked step). */
    async checkResult(runId: string) { gate(bindingOf(runId)?.projectId); await executor.advanceBlocked(runId); changed({ runId }); return ledger.get(runId)!; },
    async reworkDraft(runId: string) { const fresh = await freshRead(runId); try { return ledger.reworkDraft(runId, fresh.witness); } catch { return null; } },
    async startRework(runId: string, choice: "keep-plan" | "replan") {
      gate(bindingOf(runId)?.projectId);
      const started = await ledger.startRework(runId, choice, await freshRead(runId));
      changed({ runId: started.run.runId });
      void executor.advance(started.run.runId).then(() => changed({ runId: started.run.runId }));
      return started.run;
    },
    chatFor(target: { runId: string } | { record: WorkflowRecordRef }, role: WorkflowRoleName) {
      const record = "runId" in target ? ledger.get(target.runId)?.record : { base: target.record.base as BaseRef, rowId: target.record.rowId };
      const entry = record ? registry.get(record, role) : null;
      return entry ? { chatId: entry.chatId } : null;
    },
    needsYou(): NeedsYouItem[] {
      const waitingChats = input.turns.waitingChatIds();
      /* The record's task name as it reads now, so a list (and the phone's bell, which cannot read the Base) can name the item. */
      const titleOf = (run: WorkflowRun, taskNameColumnId: string) => {
        const value = input.bases.store.peek(run.record.base.ownerKey, run.record.base.ownerInstanceId)?.rowsById.get(run.record.rowId)?.values[taskNameColumnId];
        return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
      };
      return ledger.list().flatMap((run): NeedsYouItem[] => {
        const binding = bindings.get(run.bindingId);
        // An archived Project's runs wait for it to be restored; nothing about them can be decided meanwhile.
        if (!binding || archived(binding.projectId)) return [];
        const waitingRole = run.state === "running" ? (["plan", "develop", "review"] as const).find(role => {
          const chat = registry.get(run.record, role);
          return chat !== null && waitingChats.has(chat.chatId);
        }) : undefined;
        if (waitingRole) return [{ runId: run.runId, bindingId: run.bindingId, projectId: binding.projectId, record: run.record, recordTitle: titleOf(run, binding.base.taskNameColumnId),
          kind: "agent-waiting", role: waitingRole, since: run.updatedAt }];
        const waiting = run.confirmations.find(item => !item.decision && run.state === "waiting-human");
        const confirmStep = waiting ? run.recipe.steps.find(step => step.id === waiting.stepId) : null;
        const unknown = run.steps.some(step => step.attempts.at(-1)?.outcome === "unknown");
        const kind: NeedsYouItem["kind"] | null = confirmStep?.kind === "human.confirm" ? (confirmStep.confirmation === "plan" ? "confirm-plan" : "confirm-result")
          : run.state === "paused" ? "paused" : unknown && run.state === "blocked" ? "result-unknown" : null;
        return kind ? [{ runId: run.runId, bindingId: run.bindingId, projectId: binding.projectId, record: run.record, recordTitle: titleOf(run, binding.base.taskNameColumnId), kind,
          since: waiting?.requestedAt ?? run.updatedAt }] : [];
      });
    },
    /** "Retry this step" on a blocked step: admission again first; a new attempt only once the cause is fixed. */
    async retryStep(runId: string, stepId: string) { gate(bindingOf(runId)?.projectId); await executor.retryStep(runId, stepId); changed({ runId }); return ledger.get(runId)!; },
    evidence: (runId: string, stepId: string, kind: "diff" | "report", offset: number) => readWorkflowEvidence(ledger.get(runId), evidence, stepId, kind, offset),
    /* E-03: the same freeze and admission a run makes, per role, before a workflow is turned on. */
    /* Setup asks for one Project: its workspace is the one whose model directory counts (T21-c). */
    preflight: (roles: Parameters<typeof preflightRoles>[0], projectId?: string) => {
      const project = projectId ? input.projects.get(projectId) : null;
      const workspace = project && project.workspaceBinding.kind !== "none" ? input.projects.resolveWorkspace(project.workspaceBinding) ?? null : null;
      return preflightRoles(roles, { freeze: (id, role) => input.freezeConfig(id, role, projectId), admit: (role, frozen) => admitFrozen(role, frozen as never, admissionPorts, { workspace }),
        report: input.reportApply });
    },
    /** Delete / remove: cancel like a person, and forget runs, leases and bindings only once every run is proven stopped. */
    async removeProject(projectId: string) { try { await removeProjectWorkflows({ ledger, bindings, leases, executor }, projectId); } finally { changed({}); } },
    /** Projects removed here whose account copy the cloud outbox has yet to clear, and its acknowledgement. */
    removedProjects: () => bindings.removedProjects(),
    acknowledgeRemovedProject: (projectId: string) => bindings.acknowledgeRemoved(projectId),
    /** Whether this computer still has the Project (the cloud outbox clears a deleted or removed one from the account). */
    projectExists: (projectId: string) => input.projects.get(projectId) != null,
    projectRunCount: (projectId: string) => ledger.list().filter(run => bindings.get(run.bindingId)?.projectId === projectId).length,
    /** From the Chat machinery: a workflow turn ended (bridge-finalize's onTurnSettled). */
    async turnSettled(event: Omit<SettledTurn, "commands"> & { assistantParts?: readonly unknown[] }) {
      await executor.turnSettled({ ...event, commands: commandsFromParts(event.assistantParts, workflowCommandExits(event.requestId)) });
      changed({});
    },
    pauseForProvider: (providerId: string) => executor.pauseForProvider(providerId),
    /** A-04: the Workflow plugin was turned off: every unfinished run pauses after its current step. */
    pauseForWorkflowPlugin: () => executor.pauseForWorkflowPlugin(),
    async close() { releaseWake(); clearTimeout(clockTimer); releaseBaseEvents(); releaseInteractions(); archive.stop(); await archive.settled(); await reconciling; installStepResultIntake(null); installWorkflowRuntime(null); await ledger.closeAndFlush(); await bindings.closeAndFlush(); await leases.closeAndFlush(); },
  };
  /* D3-02: the runs follow the Project's archivedAt from any writer (the archive service, a synced head from Web or phone), in order,
     and once for every bound Project now, so a change made before the runtime existed or cut by a crash converges here. */
  const archive = followProjectArchive({ ledger, bindings, projects: input.projects, changed: () => changed({}) });
  /* DM-04(a): a Project removed while no runtime was installed skipped this cleanup; do it now, off the startup path. */
  void removeOrphanedProjectWorkflows({ ledger, bindings, leases, executor, projects: input.projects }).then(removed => { if (removed.length) changed({}); });
  installWorkflowRuntime(runtime);
  return runtime;
}
