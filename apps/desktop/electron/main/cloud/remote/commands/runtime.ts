/**
 * [INPUT]: Depends on confirmed account connections, existing executor preparation, runtime availability and coordinator/control ports.
 * [OUTPUT]: Receives commands with paced independent pagination, verified preparation, Project/Agent publication and scoped authority.
 * [POS]: Remote composition lifetime remains active while product windows are closed; logout and reconnect fence every operation.
 */
import { answerProjectQuery } from "./input/project-query";
import { RemoteQueuePublisher } from "./queue/publisher";
import { isQueueControl } from "@ai-chat/cloud-protocol/remote/queue";
import { isRemoteWorkspaceQuery } from "@ai-chat/cloud-protocol/remote/input/references";
import { RemoteWorkspaceService, type RemoteWorkspacePorts } from "./input/references";
import { applyRemoteWorkspaceQuery } from "./input/queries";
import { isRemoteTurnPayload } from "@ai-chat/cloud-protocol/remote/model";
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { RemoteCipherPort } from "@ai-chat/cloud-protocol/remote/encrypted/client";
import { sealRemoteCapabilities } from "@ai-chat/cloud-protocol/remote/encrypted/creation";
import type { ServerClock } from "@ai-chat/cloud-protocol/continuity/clock";
import type { CloudFunctionArgs, CloudFunctionResult } from "@ai-chat/cloud-protocol";
import { remoteModelsSchema, type RemoteAgentCapability, type RemoteModel } from "@ai-chat/cloud-protocol/remote/model";
import { AGENT_BACKEND_ORDER, type BackendModelInfo } from "../../../../../shared/agent-ipc";
import { acquireAgentProcessLease } from "../../../agent-process-supervisor";
import type { AgentTurn } from "../../../backends/types";
import type { BackendRuntimeSnapshot } from "../../../backends/availability/runtime";
import type { AgentBackendId } from "../../../../../shared/agent-ipc";
import { backendRuntimeRegistry, backendById } from "../../../backends";
import { submissionDecision } from "../../../../../shared/agent-availability/projection";
import { assertAgentAvailable } from "../../../agent/runtime-gate";
import { configureAgentControlLedger } from "../../../agent/controls/decisions";
import { currentAgentControlHandlers } from "../../../agent/bridge-ipc";
import type { TurnRegistry } from "../../../turn-registry";
import type { ConversationCoordinator } from "../../../sections/coordinator/conversation-coordinator";
import type { RelayLedger } from "../../../sections/coordinator/relay-ledger";
import type { ChatStore } from "../../../chats/chat-store";
import type { ProjectsService } from "../../../projects/projects-service";
import type { SettingsStore } from "../../../settings-store";
import type { CloudAccountService } from "../../runtime/service";
import type { CloudTransport } from "../../runtime/transport";
import type { SyncBindingStore } from "../../sync/account/binding";
import type { CloudExecutorService } from "../../executor/service";
import { RemoteCommandIntake, type RemoteConnection } from "./intake";
import { commandEvidence } from "./evidence";
import { mapRemoteSubmission } from "./submission";
import { applyRemoteControl, controlReport } from "./actions";
import { applyRemoteFork, type RemoteForkPort } from "./fork";
import { materializeRemoteFiles } from "./input/files";
import type { DesktopBlobStore } from "../../files/store";
import { remoteConsentMatches } from "@ai-chat/cloud-protocol/remote/input/model";
type InstalledSnapshot = BackendRuntimeSnapshot & { runtimeStatus: "installed" };
const MODEL_CATALOG_BUDGET_MS = 8_000;
/* A CLI catalog is foreign data: one out-of-contract entry would throw inside the sealed publication and take every
   Agent down with it, so an invalid catalog is withheld and the Agent stays available without a model choice. */
import { agentUsageLimitsSchema } from "@ai-chat/cloud-protocol/remote/quota";
export function remoteModels(models: readonly BackendModelInfo[]): RemoteModel[] | undefined {
  const mapped = models.slice(0, 64).map(model => ({ slug: model.slug, displayName: model.displayName, isDefault: model.isDefault,
    ...(model.serviceTiers?.length ? { serviceTiers: model.serviceTiers.slice(0, 16) } : {}),
    ...(model.defaultReasoningEffort ? { defaultReasoningEffort: model.defaultReasoningEffort } : {}),
    ...(model.supportedReasoningEfforts?.length ? { supportedReasoningEfforts: model.supportedReasoningEfforts.filter(effort => !effort.hidden).slice(0, 16)
      .map(effort => ({ id: effort.effort, displayName: effort.displayName ?? effort.effort })) } : {}) }));
  const parsed = remoteModelsSchema.safeParse(mapped);
  return parsed.success ? parsed.data : undefined;
}
type RemoteRuntimePorts = { crypto(): RemoteCipherPort; clock(): ServerClock; config: CloudBuildConfig; deviceId: string; store: ChatStore; projects: ProjectsService; settings: SettingsStore;
  /** The default workspace path: model catalogs are read there because a capability publication has no Chat to scope to. */
  workspace(): string;
  forks: RemoteForkPort;
  workspaceReferences?: RemoteWorkspacePorts;
  quotaDemand?(active: boolean): void;
  quota?(): import("../../../../../shared/usage-limits/types").UsageLimitsSnapshot;
  /** Product-window broadcast for a Chat whose options a remote turn just changed. */
  publishRecord?(record: Awaited<ReturnType<ChatStore["patchOptions"]>>): void;
  coordinator: ConversationCoordinator; ledger: RelayLedger; turns: TurnRegistry<AgentTurn>; executor: CloudExecutorService;
  account: CloudAccountService; transport: CloudTransport; binding: SyncBindingStore; files(userId: string): DesktopBlobStore;
  own(activity: { close(): Promise<void> }): () => void };
export class RemoteCommandRuntime {
  readonly intake: RemoteCommandIntake;
  private readonly queues: RemoteQueuePublisher;
  private selected: RemoteConnection | null = null;
  private baseKey = "";
  private closed = false;
  private active = false;
  private flight: Promise<void> | null = null;
  private pending = false;
  private continuation: ReturnType<typeof setTimeout> | null = null;
  private moreInbox = false;
  private morePreparations = false;
  private listeners: (() => void)[] = [];
  private readonly releaseAccount: () => void;
  private readonly releaseConnection: () => void;
  private readonly releaseAuthority: () => void;
  private lifetimeGeneration = 0;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly publication = new Map<string, string>();
  private readonly failures = new Map<string, string>();
  private configValue: CloudFunctionResult<"config:get"> | null = null;
  private inboxPage: CloudFunctionResult<"remote/commands:inbox"> | null = null;
  private prewarmPage: CloudFunctionResult<"remote/chats:preparations"> | null = null;
  private prewarmCursor: string | null = null;
  private morePrewarm = false;
  private preparationPage: CloudFunctionResult<"remote/chats:preparations"> | null = null;
  private capabilityFlight: Promise<void> | null = null;
  private inboxCursor: string | null = null;
  private preparationCursor: string | null = null;
  private publishedHeader: Omit<CloudFunctionArgs<"remote/capabilities:publish">, "agents" | "unlocked"> | null = null;
  constructor(private readonly ports: RemoteRuntimePorts) {
    const { ledger, store, turns, config, deviceId, coordinator, projects, settings, transport } = ports;
    configureAgentControlLedger(ledger, () => ({ sourceDeviceId: deviceId, sourceDeviceName: store.sync.deviceName(deviceId) }));
    const references = ports.workspaceReferences ? new RemoteWorkspaceService(deviceId, ports.workspaceReferences) : null;
    const mapping = { ledger, store, projects: projects.store, defaults: settings.getBackendDefaults.bind(settings), projectAvailable: (id: string) => projects.isUsable(id),
      publishRecord: this.ports.publishRecord, references };
    this.intake = new RemoteCommandIntake({ config, deviceId, ledger, transport, crypto: ports.crypto, clock: ports.clock, connection: () => this.connection(),
      withdrawUnpersisted: (context, current) => coordinator.withdrawUnpersistedRemote(context, current),
      evidence: (context, current, blockedBy) => commandEvidence(context, { ledger, store, turns, current }, blockedBy),
      admit: async (command, context, head, current) => {
        const saved = ledger.remote.lookup(context);
        const remoteInput = saved ? undefined : await this.prepareFiles(command, current);
        return coordinator.remote.submit(context,
          () => mapRemoteSubmission(command, head, context.scope, { ...mapping, remoteInput, current }), current);
      },
      control: (command, context, current) => isQueueControl(command.payload.kind)
        ? coordinator.editRemoteQueue(command, context, current).then(controlReport) : isRemoteWorkspaceQuery(command.payload.kind)
        ? references ? applyRemoteWorkspaceQuery(command, context, current, { workspace: references, ledger, config, files: () => ports.files(context.scope.userId),
          validate: () => this.intake.authority(context).validate(), own: ports.own }) : Promise.reject(new Error("workspace-file-unavailable"))
        : command.payload.kind === "fork-chat"
        ? applyRemoteFork(command, context, current, { ledger, store, forks: ports.forks })
        : applyRemoteControl(command, context, current,
        { ...mapping, prepareFiles: (command, current) => this.prepareFiles(command, current), crypto: ports.crypto, clock: ports.clock, config, transport, turns, handlers: currentAgentControlHandlers }) });
    this.releaseAuthority = ledger.remote.configureExecutionAuthority(context => {
      const authority = this.intake.authority(context), current = () => {
        authority.current(); const facts = store.getMetadata(context.chatId);
        if (!facts || facts.incarnationId !== context.incarnationId || facts.context.kind !== "ordinary" || facts.archivedAt || facts.readOnlyReason) throw new Error("chat-not-executable");
      };
      return { current, validate: async () => { await authority.validate(); current();
        if (context.references?.length) {
          if (!references) throw new Error("workspace-file-unavailable");
          await references.revalidate(context.chatId, context.references, current); current();
        }
      }, fullAccessFor: (chatId, incarnationId) => {
        current();
        return chatId === context.chatId && incarnationId === context.incarnationId && (ledger.remote.inheritsFullAccess(context) || remoteConsentMatches(context.fullAccessConsent, {
          userId: context.scope.userId, sourceDeviceId: context.origin.sourceDeviceId, chatId, incarnationId,
          targetDeviceId: context.targetDeviceId, executionEpoch: context.executionEpoch, intentId: context.origin.commandId,
        }));
      } };
    });
    this.queues = new RemoteQueuePublisher({ ...ports, connection: () => this.connection() });
    this.releaseAccount = ports.account.subscribeIdentity(() => this.wake());
    this.releaseConnection = ports.account.subscribeConnection(() => this.wake());
    // Both inbox and preparation changes arrive on their own subscriptions; the timer is only a missed-notification fallback.
    this.timer = setInterval(() => { this.inboxPage = null; this.preparationPage = null; this.prewarmPage = null; this.wake(); }, 60_000); this.timer.unref(); this.wake();
  }
  private async prepareFiles(command: import("@ai-chat/cloud-protocol/remote/model").RemoteCommand, current: () => void) {
    const values = isRemoteTurnPayload(command.payload) || command.payload.kind === "steer" ? command.payload.attachments ?? [] : [];
    if (!values.length) return [];
    const files = this.ports.files(this.ports.crypto().session.userId), controller = new AbortController();
    const release = this.ports.own({ close: async () => { controller.abort(); await files.close(); } });
    try { return await materializeRemoteFiles(command.chatId, values, files, current, controller.signal); }
    finally { await files.close(); release(); }
  }
  private baseConnection() {
    const account = this.ports.account.connectionIdentity(), local = this.ports.binding.snapshot(), epoch = this.ports.account.remoteConnection();
    if (this.closed || account.status !== "ready" || !epoch || !local || local.phase !== "active" || local.paused ||
      account.profile?.userId !== local.userId || account.deviceId !== this.ports.deviceId || local.deviceId !== this.ports.deviceId) return null;
    try { const crypto = this.ports.crypto(); if (crypto.session.userId !== local.userId || crypto.session.deviceId !== this.ports.deviceId) return null; } catch { return null; }
    return { scope: { environment: this.ports.config.environmentId, userId: local.userId }, connectionEpoch: epoch, manifestId: local.manifestId };
  }
  private connection() {
    return this.active && this.selected && hashChatContent(this.baseConnection()) === this.baseKey ? this.selected : null;
  }
  private stop() {
    this.ports.quotaDemand?.(false);
    this.lifetimeGeneration++; this.active = false; this.selected = null; this.baseKey = ""; this.configValue = null; this.inboxPage = null; this.preparationPage = null; this.prewarmPage = null;
    for (const release of this.listeners.splice(0)) release(); this.publication.clear(); this.failures.clear(); this.intake.reset();
    this.inboxCursor = null; this.preparationCursor = null; this.prewarmCursor = null; this.morePrewarm = false;
    this.moreInbox = false; this.morePreparations = false;
    if (this.continuation) clearTimeout(this.continuation); this.continuation = null;
  }
  wake() {
    if (this.closed) return;
    if (this.active && hashChatContent(this.baseConnection()) !== this.baseKey) this.stop();
    this.pending = true;
    if (!this.flight && !this.continuation) this.next();
  }
  private scanFailures = 0;
  private next() {
    if (this.closed) return;
    const continuing = this.moreInbox || this.morePreparations || this.morePrewarm;
    if (!continuing) this.pending = false;
    this.flight = Promise.resolve().then(() => this.scan(continuing)).then(success => {
      if (success === false) { this.scanFailures++; }
      else { this.scanFailures = 0; this.failures.delete("scan"); }
    }, error => {
      this.scanFailures++; this.pending = true;
      this.moreInbox = false; this.morePreparations = false;
      this.inboxCursor = null; this.preparationCursor = null; this.prewarmCursor = null; this.morePrewarm = false; this.reportFailure("scan", error);
    }).finally(() => {
      this.flight = null;
      if (!this.closed && (this.pending || this.moreInbox || this.morePreparations || this.morePrewarm)) {
        this.continuation = setTimeout(() => { this.continuation = null; this.next(); }, Math.min(30_000, 250 * 2 ** Math.min(this.scanFailures, 7)));
        this.continuation.unref();
      }
    });
  }
  private reportFailure(operation: "scan" | "agents" | "projects" | "prewarm", error: unknown) {
    if (process.env.BOTTEGA_SYNC_DIAGNOSTICS !== "1") return;
    const message = error instanceof Error ? error.message : "";
    const code = error instanceof Error && error.name === "ZodError" ? "validation-failed" :
      /^[A-Za-z0-9_-]{1,80}$/.test(message) ? message : "unclassified";
    if (code === "connection-changed" || this.failures.get(operation) === code) return;
    this.failures.set(operation, code);
    console.warn("[cloud-remote-failure]", { operation, code });
  }
  private async scan(continuing: boolean) {
    const base = this.baseConnection(); if (!base) { this.stop(); return; }
    // Product-window registration supplies these handlers once; closing a window does not remove them.
    try { currentAgentControlHandlers(); } catch { return; }
    const key = hashChatContent(base), lifetime = this.lifetimeGeneration;
    const current = () => { if (this.lifetimeGeneration !== lifetime || hashChatContent(this.baseConnection()) !== key) throw new Error("connection-changed"); };
    const { config, transport, executor } = this.ports, crypto = this.ports.crypto(), header = { ...protocolHeader(config), expectedUserId: base.scope.userId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
    if (!this.active) {
      current(); this.selected = { ...base, enabled: false, lifetimeGeneration: this.lifetimeGeneration }; this.baseKey = key; this.active = true;
      this.listeners.push(this.ports.own({ close: async () => { await this.suspend(); } }));
      const failed = (error: unknown) => { this.reportFailure("scan", error); this.stop(); this.pending = true;
        if (!this.flight && !this.continuation && !this.closed) {
          this.continuation = setTimeout(() => { this.continuation = null; this.next(); }, 1_000); this.continuation.unref();
        }
      };
      this.configValue = transport.configuration();
      this.listeners.push(transport.watchRemote("config:get", protocolHeader(config), value => {
        if (this.lifetimeGeneration !== lifetime) return; this.configValue = value; this.wake();
      }, failed));
      this.listeners.push(transport.watchRemote("remote/workspace:inbox", { ...header, connectionEpoch: base.connectionEpoch }, () => {
        if (this.lifetimeGeneration === lifetime) this.wake();
      }, error => this.reportFailure("scan", error)));
      this.listeners.push(transport.watchRemote("remote/commands:inbox", { ...header, connectionEpoch: base.connectionEpoch, cursor: null }, value => {
        if (this.lifetimeGeneration !== lifetime) return; this.inboxPage = value; this.wake();
      }, failed));
      this.listeners.push(transport.watchRemote("remote/chats:preparations", { ...header, connectionEpoch: base.connectionEpoch, cursor: null, purpose: "prewarm" }, value => {
        if (this.lifetimeGeneration !== lifetime) return; this.prewarmPage = value; this.wake();
      }, failed));
      this.listeners.push(transport.watchRemote("remote/chats:preparations", { ...header, connectionEpoch: base.connectionEpoch, cursor: null }, value => {
        if (this.lifetimeGeneration !== lifetime) return; this.preparationPage = value; this.wake();
      }, failed));
    }
    const publicConfig = this.configValue ?? await transport.query("config:get", protocolHeader(config)); current();
    this.configValue = publicConfig;
    this.selected = { ...base, enabled: publicConfig.remoteControlEnabled, lifetimeGeneration: this.lifetimeGeneration };
    this.queues.wake();
    this.ports.quotaDemand?.(this.selected.enabled);
    if (this.selected?.enabled && (!continuing || this.morePreparations)) {
      const preparations = (!this.preparationCursor && this.preparationPage) || await transport.query("remote/chats:preparations", { ...header, connectionEpoch: base.connectionEpoch, cursor: this.preparationCursor }); current();
      if (!preparations.complete && (!preparations.cursor || preparations.cursor === this.preparationCursor)) throw new Error("remote-preparation-cursor");
      for (const head of preparations.items) {
        current(); if (head.executorDeviceId === this.ports.deviceId && head.executionPreparation?.state === "pending") await executor.prepare(head.chat.id);
        current();
      }
      this.morePreparations = !preparations.complete;
      this.preparationCursor = preparations.complete ? null : preparations.cursor;
    }
    if (this.selected?.enabled && (!continuing || this.morePrewarm)) {
      const page = (!this.prewarmCursor && this.prewarmPage) || await transport.query("remote/chats:preparations", {
        ...header, connectionEpoch: base.connectionEpoch, cursor: this.prewarmCursor, purpose: "prewarm" }); current();
      if (!page.complete && (!page.cursor || page.cursor === this.prewarmCursor)) throw new Error("remote-prewarm-cursor");
      for (const head of page.items) if (head.pendingExecutor?.deviceId === this.ports.deviceId) {
        void executor.prewarm(head.chat.id).then(worked => { if (worked) this.wake(); }, error => this.reportFailure("prewarm", error));
      }
      this.morePrewarm = !page.complete; this.prewarmCursor = page.complete ? null : page.cursor;
    }
    current();
    // Nothing can be created for this device while remote control is disabled, so the inbox is not worth a query.
    if (!this.selected?.enabled) { this.inboxCursor = null; this.moreInbox = false; this.morePreparations = false; this.morePrewarm = false; return; }
    if (!continuing && this.ports.workspaceReferences) {
      const queries = await transport.query("remote/workspace:inbox", { ...header, connectionEpoch: base.connectionEpoch }); current();
      const workspace = new RemoteWorkspaceService(this.ports.deviceId, this.ports.workspaceReferences);
      for (const row of queries) {
        try { await answerProjectQuery(row, { workspace, crypto, deviceId: this.ports.deviceId, connectionEpoch: base.connectionEpoch,
          current, report: input => transport.mutate("remote/workspace:report", { ...header, ...input }) }); }
        catch (error) { current(); this.reportFailure("scan", error); }
      }
    }
    if (continuing && !this.moreInbox) return;
    const page = (!this.inboxCursor && this.inboxPage) || await transport.query("remote/commands:inbox", { ...header, connectionEpoch: base.connectionEpoch, cursor: this.inboxCursor }); current();
    if (!page.complete && (!page.cursor || page.cursor === this.inboxCursor)) throw new Error("remote-inbox-cursor");
    const results = await Promise.allSettled(page.items.map(receipt => this.intake.receive(receipt)));
    current();
    const rejected = results.filter(result => result.status === "rejected");
    for (const failure of rejected) this.reportFailure("scan", failure.reason);
    if (rejected.length) { this.moreInbox = true; return false; }
    this.inboxCursor = page.complete ? null : page.cursor;
    this.moreInbox = !page.complete;
    if (!continuing) this.publishLater(current);
  }
  private publishLater(current: () => void) {
    if (this.capabilityFlight) return;
    const generation = this.lifetimeGeneration;
    const flight = this.publishCapabilities(current).catch(error => this.reportFailure("agents", error));
    this.capabilityFlight = flight;
    void flight.finally(() => {
      if (this.capabilityFlight === flight) this.capabilityFlight = null;
      if (!this.closed && this.lifetimeGeneration !== generation) this.wake();
    });
  }
  /* The catalog rides with the capabilities so a browser can offer the same models the desktop composer does. The
     descriptor's catalog is TTL-cached and stale-while-revalidate, so this is one probe per backend, not one per publish;
     only a newly started probe is admitted, and as a background one so it never preempts a user's own quota read.
     A slow or failing probe only withholds the catalog — the Agent stays available without a model choice. */
  private async publishedModels(backend: AgentBackendId, runtime: InstalledSnapshot): Promise<RemoteModel[] | undefined> {
    const descriptor = backendById(backend);
    if (!descriptor.models || runtime.capabilities.modelOptions === "none") return undefined;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), MODEL_CATALOG_BUDGET_MS);
    try {
      return remoteModels(await descriptor.models.list(runtime.runtime, this.ports.workspace(), controller.signal, async (read, signal) => {
        const lease = await acquireAgentProcessLease(backend, "background", signal, { quota: "wait" });
        try { return await read(); } finally { lease.release(); }
      }));
    } catch { return undefined; }
    finally { clearTimeout(timer); }
  }
  private async publishCapabilities(current: () => void) {
    const connection = this.connection(); if (!connection?.enabled) return;
    const { config, transport, settings, projects } = this.ports;
    const crypto = this.ports.crypto(), header = { ...protocolHeader(config), expectedUserId: connection.scope.userId, connectionEpoch: connection.connectionEpoch,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
    // Folder availability must not wait for Agent discovery or an optional model catalog publication.
    let projectFailed = false;
    for (const project of projects.store.list()) {
      const bound = project.workspaceBinding.kind === "external" && projects.isUsable(project.id), key = `project:${project.id}`;
      if (this.publication.get(key) === String(bound)) continue;
      current();
      try { await transport.mutate("remote/capabilities:project", { ...header, projectId: project.id, bound }); current(); this.publication.set(key, String(bound)); }
      catch (error) { current(); projectFailed = true; this.reportFailure("projects", error); }
    }
    if (!projectFailed) this.failures.delete("projects");
    try {
      const agents: RemoteAgentCapability[] = await Promise.all(AGENT_BACKEND_ORDER.map(async backend => {
        const options = settings.getBackendDefaults(backend);
        try {
          const runtime = await backendRuntimeRegistry.resolve(backend);
          const decision = submissionDecision(runtime, Date.now());
          if (decision.decision !== "allow") {
            const reasons = { missing: "agent-missing", unsupported: "agent-outdated", "auth-required": "auth-required" } as const;
            const reason = reasons[decision.reason as keyof typeof reasons] ?? "agent-unavailable";
            return { backend, options, available: false, reason } as RemoteAgentCapability;
          }
          assertAgentAvailable(runtime, backendById(backend).displayName); current();
          const { imageInput, planMode, permissionModes } = runtime.capabilities;
          const models = await this.publishedModels(backend, runtime); current();
          return { backend, options, capabilities: { imageInput, fileInput: true, planMode, permissionModes }, available: true, reason: null,
            ...(models ? { models } : {}) } as RemoteAgentCapability;
        } catch { return { backend, options, available: false, reason: "agent-unavailable" } as RemoteAgentCapability; }
      }));
      current();
      const quota = this.ports.quota?.();
      for (const agent of agents) {
        const reading = quota?.agents.find(item => item.backend === agent.backend);
        const parsed = agentUsageLimitsSchema.safeParse(reading);
        if (parsed.success) agent.quota = parsed.data;
      }
      const digest = hashChatContent(agents);
      if (this.publication.get("agents") !== digest) {
        const encrypted = await sealRemoteCapabilities(agents, connection.connectionEpoch, protocolHeader(config), crypto); current();
        await transport.mutate("remote/capabilities:publish", { ...header, agents: encrypted, unlocked: true }); current();
        this.publishedHeader = header; this.publication.set("agents", digest);
      }
      this.failures.delete("agents");
    } catch (error) { current(); this.reportFailure("agents", error); }
  }
  async suspend() {
    const header = this.publishedHeader; this.publishedHeader = null; this.stop(); try { this.ports.clock().invalidate(); } catch { /* Locked key owners have already invalidated their clock. */ }
    if (header && this.ports.account.remoteConnection() === header.connectionEpoch && this.ports.account.connectionIdentity().profile?.userId === header.expectedUserId)
      await this.ports.transport.mutate("remote/capabilities:publish", { ...header, agents: [], unlocked: false }).catch(error => this.reportFailure("agents", error));
    await this.intake.settled();
  }
  async close() { this.closed = true; await this.queues.close(); clearInterval(this.timer); this.releaseAccount(); this.releaseConnection(); this.releaseAuthority(); await this.suspend(); await this.flight; await this.capabilityFlight; await this.intake.settled(); }
}
