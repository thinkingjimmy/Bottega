/**
 * [INPUT]: Depends on account-scope admission, encrypted resource codecs, owner workflow/App/record ports, plugin request inbox and Memory barriers.
 * [OUTPUT]: Provides ResourceCommandRuntime and ResourceCommandPorts with verified operator identity, exact action classes, durable receipts and no replay of unknown effects.
 * [POS]: Owner-computer executor; installation commands enqueue a source or read requester-bound status; record commands use owner-bound ports and account-fenced encrypted replies.
 */
import { setAppEnabledInputSchema, type AppDisableImpact, type SetAppEnabledInput } from "@ai-chat/cloud-protocol/apps/build-status/enablement";
import { openResourceCommand, prepareResourceResult } from "@ai-chat/cloud-protocol/resources/encrypted";
import { RESOURCE_REFUSALS, type EncryptedResourceCommand, type ResourceCommandBody, type ResourceRefusal, type ResourceResultBody } from "@ai-chat/cloud-protocol/resources/model";
import type { ConfirmInput, VerifiedOperator } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import type { AccountTransport } from "../../runtime/transport/transport";
import type { CloudAccountService } from "../../runtime/service";
import { accountScopeAdmission, type AdmissionPorts, type Admitted } from "../../sync/account-config/admission";

import type { MemoryControlBarrier } from "../memory/runtime";
import type { WorkflowEvidencePage } from "@bottega/contracts/workflow/bridge";
import { previewFeature } from "../../../preview/session/runtime";
import { pluginInstallRequests, setPluginInstallAccount, type PluginInstallRequests } from "../../../extensions/install/renderer/requests";
import { pluginInstallSourceSchema } from "@ai-chat/cloud-protocol/resources/plugin-install";
import type { RecordResourcePort } from "./records";
declare const __BOTTEGA_SERVER_TUNNEL__: boolean;
const extension = (): ReturnType<typeof import("../../../apps/gateway/tunnel/entry").resourceExtension> =>
  typeof __BOTTEGA_SERVER_TUNNEL__ !== "undefined" && __BOTTEGA_SERVER_TUNNEL__
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Independent optional build entry; a source import would join the production closure.
    ? require("../../../server-tunnel-entry.js").resourceExtension() : null;
type RunFacts = { runId: string; revision: number; confirmations: readonly { stepId: string; proposalDigest: string; decision: unknown; expiredAt: number | null }[] };
export type WorkflowRunAction = "cancel" | "force-stop" | "pause" | "resume" | "check-result" | "retry-step" | "start-rework";
/** The workflow runtime as a remote sender may use it; every answer is the run after the action (its ledger revision). */
export type WorkflowResourcePort = {
  run(runId: string): RunFacts | null;
  confirm(runId: string, stepId: string, input: ConfirmInput, operator: VerifiedOperator): Promise<{ revision: number }>;
  act(action: WorkflowRunAction, runId: string, input: Record<string, unknown>): Promise<{ runId: string; revision: number }>;
  start(bindingId: string, rowId: string): Promise<{ runId: string; revision: number }>;
  evidence?(runId: string, stepId: string, kind: "diff" | "report", offset: number): Promise<WorkflowEvidencePage>;
  enableBlockingPlugin?(runId: string, stepId: string, expectedRevision: number): Promise<{ revision: number }>;
};
/** An App's Chats as a remote sender opens them (U06): on the owner, under the command's id, without taking its window's focus. */
export type AppResourcePort = {
  disableImpact(appId: string): Promise<AppDisableImpact>;
  setEnabled(input: SetAppEnabledInput): Promise<{ enabledRevision: number }>;
  openUseChat(appId: string, mode: "current" | "new", requestId: string): Promise<{ chatId: string }>;
  /** The latest Edit Chat, or null while the App has none: the sender then starts one (Q-U7). */
  openEditor(appId: string, requestId: string): Promise<{ chatId: string | null }>;
  /** U06-d: retries a failed after-edit build in the background, or converges on the build that runs or landed; throws a refusal code. */
  rebuild(appId: string): void;
  /** U06-d: a remote device's only extension decision; first writer wins. */
  declineExtension(appId: string, requestId: string, deviceName: string): "declined" | "already-resolved" | "not-waiting";
};
export type ResourceCommandPorts = AdmissionPorts & {
  account: AdmissionPorts["account"] & Pick<CloudAccountService, "subscribeIdentity" | "subscribeConnection">;
  transport: Pick<AccountTransport, "query" | "mutate" | "watchResourceInbox">;
  memoryBarrier?: Pick<MemoryControlBarrier, "beforeRemote">;
  /** Null until the workflow runtime is loaded (it loads after startup); workflow commands are then refused. */
  workflows(): WorkflowResourcePort | null;
  /** Null until the App service is loaded; App commands are then refused. */
  apps?(): AppResourcePort | null;
  /** The owner request inbox; this port has no install-confirmation operation. */
  plugins?(): Pick<PluginInstallRequests, "request" | "status"> | null;
  records?: RecordResourcePort;
  /** The account's name for a device, for the Edit Chat line that says where a decline came from. */
  deviceName?(deviceId: string): string;
  quota: { known(provider: string): boolean; refresh(provider: string): Promise<void> };
  /** After a refresh: the capability publication carries the new snapshot to the phone. */
  onQuotaRefreshed?(): void;
  own?(activity: { close(): Promise<void> }): () => void;
  report?(error: unknown): void;
  now?(): number;
};
class Refused extends Error { constructor(readonly code: ResourceRefusal) { super(code); } }
const refusal = (error: unknown): ResourceRefusal => {
  if (error instanceof Refused) return error.code;
  // A typed error names its code on `.code` and keeps a readable message (RecoveryPendingError); a plain one carries the code as its message.
  const typed = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
  const code = typed ?? (error instanceof Error ? error.message : "");
  return (RESOURCE_REFUSALS as readonly string[]).includes(code) ? code as ResourceRefusal : "failed";
};
/* Once a minute even without a push, so a missed update never strands a command until it expires. */
const FALLBACK_MS = 60_000;

export class ResourceCommandRuntime {
  private key = "";
  private flight: Promise<void> | null = null;
  private again = false;
  private closed = false;
  private readonly running = new Set<string>();
  private readonly refreshes = new Map<string, Promise<void>>();
  private watching: (() => void) | null = null;
  private scoped: (() => void) | null = null;
  private readonly releases: (() => void)[] = [];
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  constructor(private readonly ports: ResourceCommandPorts) {
    this.now = ports.now ?? Date.now;
    setPluginInstallAccount(() => { const current = accountScopeAdmission(ports); return !this.closed && current.kind === "admitted" ? current.header.expectedUserId : null; });
    const wake = () => { pluginInstallRequests()?.accountChanged(); this.wake(); };
    this.releases.push(ports.account.subscribeIdentity(wake), ports.account.subscribeConnection(wake));
    this.timer = setInterval(wake, FALLBACK_MS); this.timer.unref?.();
    wake();
  }
  wake() {
    if (this.closed) return;
    if (this.flight) { this.again = true; return; }
    const flight = (async () => { do { this.again = false; await this.pass(); } while (this.again && !this.closed); })()
      .finally(() => { if (this.flight === flight) this.flight = null; });
    this.flight = flight;
  }
  /** Settles once no pass is running or queued and every command it started has been answered. */
  async idle() { while (this.flight) await this.flight.catch(() => undefined); }
  async close() {
    this.closed = true; clearInterval(this.timer); this.stop();
    for (const release of this.releases.splice(0)) release();
    await this.flight?.catch(() => undefined);
  }
  private stop() { this.watching?.(); this.watching = null; this.scoped?.(); this.scoped = null; }

  private async pass() {
    const admission = accountScopeAdmission(this.ports);
    if (admission.kind !== "admitted") { this.stop(); extension()?.reset(); this.key = ""; return; }
    if (admission.key !== this.key) {
      extension()?.reset();
      this.stop(); this.key = admission.key;
      this.scoped = this.ports.own?.({ close: async () => { this.stop(); await this.flight?.catch(() => undefined); } }) ?? null;
      try { this.watching = this.ports.transport.watchResourceInbox?.(admission.header, () => this.wake(), error => this.ports.report?.(error)) ?? null; }
      catch (error) { this.ports.report?.(error); }
    }
    try {
      await this.ports.memoryBarrier?.beforeRemote();
      const { items } = await this.ports.transport.query("resources/commands:inbox", admission.header);
      await Promise.all(items.filter(item => !this.running.has(item.command.commandId)).map(item => {
        this.running.add(item.command.commandId);
        // An accepted command this launch did not start was accepted by one that stopped before answering: it may have run.
        const work = item.state === "accepted" ? this.settle(admission, item.command, 2, "unknown", null) : this.process(admission, item.command);
        return work.catch(error => this.ports.report?.(error)).finally(() => this.running.delete(item.command.commandId));
      }));
    } catch (error) { this.ports.report?.(error); }
  }

  private async process(admission: Admitted, command: EncryptedResourceCommand) {
    await this.ports.memoryBarrier?.beforeRemote();
    if (accountScopeAdmission(this.ports).kind !== "admitted") throw new Error("connection-changed");
    // Past its expiry on this clock it never runs; the server settles it expired.
    if (this.now() >= command.expiresAt) return;
    let opened: Awaited<ReturnType<typeof openResourceCommand>> | null = null;
    let effect: import("../../../apps/gateway/tunnel/commands").TunnelEffect | null = null;
    try { opened = await openResourceCommand(command, { targetDeviceId: this.ports.deviceId }, admission.crypto); }
    catch {
      try { effect = await extension()?.open(command, this.ports.deviceId, admission.crypto) ?? null; } catch { /* Unknown or malformed extensions use the same closed refusal. */ }
      if (!effect) return this.settle(admission, command, 1, "refused", { ok: false, code: "invalid-command" });
    }
    if (opened && !opened.classMatches) return this.settle(admission, command, 1, "refused", { ok: false, code: "class-mismatch" });
    /* C2-03: the server answers expired for an acceptance past the deadline; only an acceptance it recorded may run, and only
       while the deadline still holds on this clock. Past it, the effect never happens and the command settles refused. */
    const current = accountScopeAdmission(this.ports);
    if (current.kind !== "admitted" || current.key !== admission.key) throw new Error("connection-changed");
    const accepted = await this.settle(admission, command, 1, "accepted", null);
    if (accepted?.state !== "accepted") return;
    await this.ports.memoryBarrier?.beforeRemote();
    const stillCurrent = accountScopeAdmission(this.ports);
    if (stillCurrent.kind !== "admitted" || stillCurrent.key !== admission.key) return;
    if (this.now() >= command.expiresAt) return this.settle(admission, command, 2, "refused", { ok: false, code: "command-expired" }).then(() => undefined);
    let body: ResourceResultBody;
    try {
      if (effect) {
        const result = await effect();
        await this.ports.transport.mutate("resources/commands:settle", { ...admission.header, commandId: command.commandId, ciphertextHash: command.packet.ciphertextHash, result }); return;
      }
      body = await this.execute(command, opened!.body, { userId: admission.header.expectedUserId, deviceId: command.sourceDeviceId });
    }
    catch (error) { body = { ok: false, code: refusal(error) }; }
    await this.settle(admission, command, 2, body.ok ? "succeeded" : "refused", body);
  }

  /** The operator is the account and the device the server verified as sender, never a payload field (F10). */
  private async execute(command: EncryptedResourceCommand, body: ResourceCommandBody, operator: VerifiedOperator): Promise<ResourceResultBody> {
    const input = body.input as Record<string, unknown>;
    if (command.resourceKind === "plugin") {
      if (["plugin-record-read", "plugin-record-report", "plugin-record-results"].includes(body.action)) {
        if (!this.ports.records) throw new Refused("plugin-record-unavailable");
        return { ok: true, pluginRecord: await this.ports.records.execute(body.action, command.resourceId, body.input, operator.userId) };
      }
      const requests = this.ports.plugins ? this.ports.plugins() : pluginInstallRequests();
      if (!requests) throw new Refused("plugin-request-unavailable");
      if (body.action === "plugin-install-request") return { ok: true, pluginInstall: await requests.request({ requestId: command.resourceId,
        userId: operator.userId, sourceDeviceId: operator.deviceId, source: pluginInstallSourceSchema.parse(body.input) }) };
      if (body.action === "plugin-install-status") return { ok: true, pluginInstall: await requests.status(command.resourceId, operator.userId, operator.deviceId) };
      throw new Refused("unsupported-action");
    }
    if (command.resourceKind === "preview") {
      const preview = previewFeature();
      if (!preview) throw new Refused("tunnel-plugin-disabled");
      return { ok: true, preview: await preview.sessions.action(body.action, { serverId: command.resourceId,
        chatId: input.chatId as string, incarnationId: input.incarnationId as string }, "remote", command.commandId) };
    }
    if (body.action === "refresh") {
      if (!this.ports.quota.known(command.resourceId)) throw new Refused("provider-unknown");
      await this.refresh(command.resourceId);
      return { ok: true };
    }
    if (command.resourceKind === "app") return this.app(command, body);
    const workflows = this.ports.workflows();
    if (!workflows) throw new Refused("workflow-plugin-disabled");
    if (body.action === "start") {
      const started = await workflows.start(command.resourceId, input.rowId as string);
      return { ok: true, runId: started.runId, revision: started.revision + 1 };
    }
    const run = workflows.run(command.resourceId);
    if (!run) throw new Refused("workflow-run-not-found");
    if (body.action === "read-evidence") {
      if (!workflows.evidence) throw new Refused("unsupported-action");
      return { ok: true, evidence: await workflows.evidence(run.runId, input.stepId as string, input.kind as "diff" | "report", input.offset as number) };
    }
    if (body.action === "enable-blocking-plugin") {
      if (!workflows.enableBlockingPlugin) throw new Refused("unsupported-action");
      const after = await workflows.enableBlockingPlugin(run.runId, input.stepId as string, input.expectedRevision as number);
      return { ok: true, revision: after.revision + 1 };
    }
    if (body.action === "confirm") {
      // The owner finds the waiting confirmation by the proposal the phone saw; none matching means it changed.
      const confirm = input as ConfirmInput;
      const waiting = run.confirmations.find(item => !item.decision && item.expiredAt === null && item.proposalDigest === confirm.proposalDigest);
      if (!waiting) throw new Refused("stale-proposal");
      const after = await workflows.confirm(run.runId, waiting.stepId, confirm, operator);
      return { ok: true, revision: after.revision + 1 };
    }
    const after = await workflows.act(body.action as WorkflowRunAction, run.runId, input);
    return body.action === "start-rework" ? { ok: true, runId: after.runId, revision: after.revision + 1 } : { ok: true, revision: after.revision + 1 };
  }
  /** The command id is the idempotency id: the owner never runs a command twice, and its App slots are keyed by it (U-3). */
  private async app(command: EncryptedResourceCommand, body: ResourceCommandBody): Promise<ResourceResultBody> {
    const apps = this.ports.apps?.();
    if (!apps) throw new Refused("failed");
    if (body.action === "disable-impact") return { ok: true, appImpact: await apps.disableImpact(command.resourceId) };
    if (body.action === "set-enabled") {
      const input = setAppEnabledInputSchema.parse(body.input);
      if (input.appId !== command.resourceId) throw new Refused("invalid-command");
      const changed = await apps.setEnabled(input);
      return { ok: true, revision: changed.enabledRevision + 1 };
    }
    if (body.action === "rebuild") { apps.rebuild(command.resourceId); return { ok: true }; }
    if (body.action === "decline-extension") {
      // The device is the one the server verified as sender, never a payload field.
      const answer = apps.declineExtension(command.resourceId, (body.input as { requestId: string }).requestId,
        this.ports.deviceName?.(command.sourceDeviceId) ?? command.sourceDeviceId);
      if (answer !== "declined") throw new Refused(answer);
      return { ok: true };
    }
    const opened = body.action === "open-use-chat"
      ? await apps.openUseChat(command.resourceId, (body.input as { mode: "current" | "new" }).mode, command.commandId)
      : await apps.openEditor(command.resourceId, command.commandId);
    return opened.chatId ? { ok: true, chatId: opened.chatId } : { ok: true };
  }
  /** R24-5: a refresh while one Provider's read is running joins it. */
  private refresh(provider: string) {
    const running = this.refreshes.get(provider);
    if (running) return running;
    const read = this.ports.quota.refresh(provider).finally(() => { this.refreshes.delete(provider); this.ports.onQuotaRefreshed?.(); });
    this.refreshes.set(provider, read);
    return read;
  }
  private async settle(admission: Admitted, command: EncryptedResourceCommand, revision: number, state: "accepted" | "succeeded" | "refused" | "unknown", body: ResourceResultBody | null) {
    const current = accountScopeAdmission(this.ports);
    if (current.kind !== "admitted" || current.key !== admission.key) return;
    const result = await prepareResourceResult(command, { revision, state, body }, admission.crypto);
    const after = accountScopeAdmission(this.ports);
    if (after.kind !== "admitted" || after.key !== admission.key) return;
    return this.ports.transport.mutate("resources/commands:settle", { ...admission.header, commandId: command.commandId, ciphertextHash: command.packet.ciphertextHash, result });
  }
}
