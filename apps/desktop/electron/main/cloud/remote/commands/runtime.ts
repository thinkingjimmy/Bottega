/**
 * [INPUT]: Depends on the built-in Provider catalog's narrowing (the stored order is published as built-ins only until S5–S7), confirmed account connections, existing execution preparation, runtime availability, the shared Memory reconnect barrier and coordinator/control ports.
 * [OUTPUT]: Receives commands with paced independent pagination, bounded independent Chat preparation, observation and capability publication before the execution-only Memory barrier, Project/Agent publication (changed Project facts in batched pages), the phone Memory facade status (TASK-28, R-33), the claim of this computer's App Edit reservations (U06 Q7-b) and scoped authority; scans reuse pushed workspace-inbox and reservation pages and pass live Chat heads to intake (T20-5). Queue mutations reuse coordinator authority and conversation locking.
 * [POS]: Remote composition lifetime remains active while product windows are closed; logout and reconnect fence every operation.
 */
import { recoveryDiagnostics } from "../../runtime/diagnostics/timeline";
import { answerProjectQuery } from "./input/project-query";
import { RemoteQueuePublisher } from "./queue/publisher";
import { isQueueControl } from "@ai-chat/cloud-protocol/remote/queue";
import { isRemoteWorkspaceQuery } from "@ai-chat/cloud-protocol/remote/input/references";
import { RemoteWorkspaceService, type RemoteWorkspacePorts } from "./input/references";
import { applyRemoteWorkspaceQuery } from "./input/queries";
import { isRemoteTurnPayload, REMOTE_LIMITS } from "@ai-chat/cloud-protocol/remote/model";
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { RemoteCipherPort } from "@ai-chat/cloud-protocol/remote/encrypted/client";
import { sealRemoteCapabilities } from "@ai-chat/cloud-protocol/remote/encrypted/creation";
import { sealRemotePlugins } from "@ai-chat/cloud-protocol/surfaces/plugin/catalog-codec";
import type { PluginSurfaceSource } from "../../sync/surfaces/source";
import { sealRemoteMemory } from "@ai-chat/cloud-protocol/remote/memory";
import type { RemoteMemoryStatus } from "@ai-chat/cloud-protocol/remote/memory-status";
import { memoryFacadeState } from "../../../../../shared/memory/facade";
import type { MemoryStatusSnapshot } from "../../../../../shared/ipc/content/memory-ipc";
import type { ServerClock } from "@ai-chat/cloud-protocol/continuity/clock";
import type { CloudFunctionArgs, CloudFunctionResult } from "@ai-chat/cloud-protocol";
import { remoteModelsSchema, type RemoteAgentCapability, type RemoteModel } from "@ai-chat/cloud-protocol/remote/model";
import type { BackendModelInfo } from "../../../../../shared/ipc/agent/agent-ipc";
import type { AgentTurn } from "../../../backends/types";
import type { BackendRuntimeSnapshot } from "../../../backends/runtime/availability/runtime";
import type { AgentBackendId } from "../../../../../shared/ipc/agent/agent-ipc";
import { builtinProviderCatalog, knownBackend } from "../../../../../shared/providers/catalog";
import { backendRuntimeRegistry, backendById } from "../../../backends";
import { submissionDecision } from "../../../../../shared/agent-availability/projection";
import { assertAgentAvailable } from "../../../agent/admission/runtime-gate";
import { configureAgentControlLedger } from "../../../agent/controls/decisions";
import { currentAgentControlHandlers } from "../../../agent/bridge/bridge-ipc";
import type { TurnRegistry } from "../../../agent/turns/turn/turn-registry";
import type { ConversationCoordinator } from "../../../sections/coordinator/conversation-coordinator";
import type { RelayLedger } from "../../../sections/coordinator/relay-ledger";
import type { ChatStore } from "../../../chats/chat-store";
import type { ProjectsService } from "../../../projects/projects-service";
import type { SettingsStore } from "../../../settings/settings-store";
import type { CloudAccountService } from "../../runtime/service";
import type { CloudTransport } from "../../runtime/transport/transport";
import type { SyncBindingStore } from "../../sync/account/binding";
import type { CloudExecutionService } from "../../execution/service";
import { RemoteCommandIntake, type RemoteConnection } from "./intake";
import { commandEvidence } from "./dispatch/evidence";
import { RemoteReservationClaims } from "../resources/reservations";
import type { RemoteAppNavigation } from "../resources/apps";
import { assertRemoteChatCurrent, mapRemoteFirstMessage, mapRemoteSubmission } from "./dispatch/submission";
import { applyRemoteControl, controlReport } from "./dispatch/actions";
import { applyRemoteFork, type RemoteForkPort } from "./dispatch/fork";
import { materializeRemoteFiles } from "./input/files";
import type { DesktopBlobStore } from "../../files/store";
import { remoteConsentMatches } from "@ai-chat/cloud-protocol/remote/input/model";
import type { MemoryControlBarrier, MemoryControlPort } from "../memory/runtime";
type InstalledSnapshot = BackendRuntimeSnapshot & { runtimeStatus: "installed" };
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
export type RemoteRuntimePorts = { crypto(): RemoteCipherPort; clock(): ServerClock; config: CloudBuildConfig; deviceId: string; store: ChatStore; projects: ProjectsService; settings: SettingsStore;
  /** T20-5: a Chat head a live renderer subscription already holds (the Chat reader's), so intake need not query it. */
  liveHead?(chatId: string): CloudFunctionResult<"chats/metadata:head"> | undefined;
  /** The default workspace path: model catalogs are read there because a capability publication has no Chat to scope to. */
  workspace(): string;
  forks: RemoteForkPort;
  workspaceReferences?: RemoteWorkspacePorts;
  quota?(): import("../../../../../shared/usage-limits/types").UsageLimitsSnapshot;
  /** This computer's Memory status, shown on its phones as one sentence while Settings › Memory allows it (TASK-28). */
  plugins?(): PluginSurfaceSource | null;
  memory?: MemoryControlPort & { status(): MemoryStatusSnapshot; onStatus(listener: () => void): () => void };
  memoryBarrier?: Pick<MemoryControlBarrier, "beforeRemote" | "beforeTransferred">;
  /** U06 Q7-b: the App check behind a reservation claim; null until App mode is configured. */
  apps?(): Pick<RemoteAppNavigation, "editorAvailability" | "latestEditorChat"> | null;
  /** Product-window broadcast for a Chat whose options a remote turn just changed. */
  publishRecord?(record: Awaited<ReturnType<ChatStore["patchOptions"]>>): void;
  coordinator: ConversationCoordinator; ledger: RelayLedger; turns: TurnRegistry<AgentTurn>; execution: CloudExecutionService;
  account: CloudAccountService; transport: CloudTransport; binding: SyncBindingStore; files(userId: string): DesktopBlobStore;
  remoteReady?(): boolean;
  onRemoteReady?(listener: () => void): () => void;
  own(activity: { close(): Promise<void> }): () => void };
export class RemoteCommandRuntime {
  readonly intake: RemoteCommandIntake;
  private readonly reservations: RemoteReservationClaims;
  private readonly queues: RemoteQueuePublisher;
  private selected: RemoteConnection | null = null;
  private baseKey = "";
  private closed = false;
  private active = false;
  private memoryReady = false;
  private capabilitiesReady = false;
  private flight: Promise<void> | null = null;
  private pending = false;
  private continuation: ReturnType<typeof setTimeout> | null = null;
  private moreInbox = false;
  private morePreparations = false;
  private listeners: (() => void)[] = [];
  private readonly releaseAccount: () => void;
  private readonly releaseConnection: () => void;
  private readonly releaseAuthority: () => void;
  private readonly releaseTransferred: () => void;
  private lifetimeGeneration = 0;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly publication = new Map<string, string>();
  private readonly failures = new Map<string, string>();
  private configValue: CloudFunctionResult<"config:get"> | null = null;
  private inboxPage: CloudFunctionResult<"remote/commands:inbox"> | null = null;
  private preparationPage: CloudFunctionResult<"remote/chats:preparations"> | null = null;
  /* T20-5: what the workspace-inbox and reservation subscriptions last pushed, so a scan does not read them again; the
     60 s safety net drops them with the other pages. A cached inbox row is answered once. */
  private workspaceInbox: CloudFunctionResult<"remote/workspace:inbox"> | null = null;
  private reservationPage: CloudFunctionResult<"remote/chats:reservations"> | null = null;
  private readonly answeredQueries = new Set<string>();
  private capabilityFlight: Promise<void> | null = null;
  private readonly preparations = new Map<string, Promise<void>>();
  private readonly preparationQueue = new Map<string, { current(): void; generation: number }>();
  private readonly releaseRemoteReady: () => void;
  private capabilityDirty = false;
  /* Agent capabilities are rebuilt only when an input changed: a runtime or settings event, a quota reading, the connection
     or key, or a ten-minute tick for model catalogs; every scan (even one this runtime caused) used to rebuild them (B-17). */
  private agentInputs = 0;
  private agentsKey: string | null = null;
  private memorySince: { key: string; at: number } | null = null;
  private readonly releaseAgentInputs: () => void;
  private inboxCursor: string | null = null;
  private preparationCursor: string | null = null;
  private publishedHeader: Omit<CloudFunctionArgs<"remote/capabilities:publish">, "agents" | "unlocked" | "memory" | "plugins"> | null = null;
  constructor(private readonly ports: RemoteRuntimePorts) {
    const { ledger, store, turns, config, deviceId, coordinator, projects, settings, transport } = ports;
    configureAgentControlLedger(ledger, () => ({ sourceDeviceId: deviceId, sourceDeviceName: store.sync.deviceName(deviceId) }));
    const references = ports.workspaceReferences ? new RemoteWorkspaceService(deviceId, ports.workspaceReferences) : null;
    /* U06 Q7: the reservation claim, and the materialisation of a reservation's first message into its App's first Edit Chat. The Agent is
       checked here (the server cannot see the reservation's), and the create-app goes through the same remote admission as any turn. */
    this.reservations = new RemoteReservationClaims({ crypto: ports.crypto, transport, apps: () => ports.apps?.() ?? null, report: error => this.reportFailure("scan", error),
      localChat: chatId => store.getMetadata(chatId) ?? null,
      agentReady: async backend => {
        try { assertAgentAvailable(await backendRuntimeRegistry.resolveForSpawn(backend), backendById(backend).displayName); return true; } catch { return false; }
      },
      submit: (command, context, target, current) => coordinator.remote.submit(context,
        () => mapRemoteFirstMessage(command, target, context.scope, { defaults: settings.getBackendDefaults.bind(settings), current }), current) });
    const mapping = { ledger, store, projects: projects.store, defaults: settings.getBackendDefaults.bind(settings), projectAvailable: (id: string) => projects.isUsable(id),
      publishRecord: this.ports.publishRecord, references };
    this.intake = new RemoteCommandIntake({ config, deviceId, ledger, transport, crypto: ports.crypto, clock: ports.clock, connection: () => this.connection(),
      liveHead: chatId => ports.liveHead?.(chatId),
      reservedFirst: wire => this.reservations.reservedFirst(wire),
      materialise: (command, context, reserved, current) => this.reservations.materialise(command, context, reserved, current),
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
        { ...mapping, queueMutation: action => coordinator.mutateRemoteQueue(context, current, action), prepareFiles: (command, current) => this.prepareFiles(command, current), crypto: ports.crypto, clock: ports.clock, config, transport, turns, handlers: currentAgentControlHandlers }) });
    this.releaseTransferred = ledger.remote.configureTransferredBarrier(() => ports.memoryBarrier?.beforeTransferred() ?? Promise.resolve());
    this.releaseAuthority = ledger.remote.configureExecutionAuthority(context => {
      const authority = this.intake.authority(context), current = () => {
        authority.current(); assertRemoteChatCurrent(store, ledger, context);
      };
      return { current, validate: async () => { await authority.validate(); current();
        if (context.references?.length) {
          if (!references) throw new Error("workspace-file-unavailable");
          await references.revalidate(context.chatId, context.references, current); current();
        }
        await ports.memoryBarrier?.beforeRemote(); current();
      }, fullAccessFor: (chatId, incarnationId) => {
        current();
        return chatId === context.chatId && incarnationId === context.incarnationId && (ledger.remote.inheritsFullAccess(context) || remoteConsentMatches(context.fullAccessConsent, {
          userId: context.scope.userId, sourceDeviceId: context.origin.sourceDeviceId, chatId, incarnationId,
          targetDeviceId: context.targetDeviceId, intentId: context.origin.commandId,
        }));
      } };
    });
    this.queues = new RemoteQueuePublisher({ ...ports, connection: () => this.connection() });
    this.releaseAccount = ports.account.subscribeIdentity(() => this.wake());
    this.releaseRemoteReady = ports.onRemoteReady?.(() => this.wake()) ?? (() => {});
    const bump = () => { this.agentInputs += 1; };
    // A Memory change only republishes the capability packet; it never costs an inbox scan.
    let facadeOn = ports.settings.get().memoryPhoneFacade;
    const stopRuntime = backendRuntimeRegistry.subscribe(bump), stopSettings = ports.settings.onChanged(() => {
      bump(); if (facadeOn !== ports.settings.get().memoryPhoneFacade) { facadeOn = !facadeOn; this.republish(); }
    });
    const stopMemory = ports.memory?.onStatus(() => { bump(); this.republish(); });
    const stopPlugins = ports.plugins?.()?.onChanged(() => {bump();this.republish();});
    this.releaseAgentInputs = () => { stopRuntime(); stopSettings(); stopMemory?.(); stopPlugins?.(); };
    this.releaseConnection = ports.account.subscribeConnection(() => this.wake());
    // Both inbox and preparation changes arrive on their own subscriptions; the timer is only a missed-notification fallback.
    this.timer = setInterval(() => { this.inboxPage = null; this.preparationPage = null; this.workspaceInbox = null; this.reservationPage = null; this.wake(); }, 60_000); this.timer.unref(); this.wake();
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
    if (this.closed || account.status !== "ready" || !epoch || !local || local.phase === "closing" || local.paused ||
      !(this.ports.remoteReady?.() ?? local.phase === "active") ||
      account.profile?.userId !== local.userId || account.deviceId !== this.ports.deviceId || local.deviceId !== this.ports.deviceId) return null;
    try {
      const crypto = this.ports.crypto();
      if (crypto.session.userId !== local.userId || crypto.session.deviceId !== this.ports.deviceId ||
        local.encryption && (hashChatContent(local.encryption.scope) !== hashChatContent(crypto.scope) || local.encryption.keyPackageFingerprint !== crypto.keyPackageFingerprint)) return null;
    } catch { return null; }
    return { scope: { environment: this.ports.config.environmentId, userId: local.userId }, connectionEpoch: epoch, manifestId: local.manifestId };
  }
  private connection() {
    return this.active && this.selected && hashChatContent(this.baseConnection()) === this.baseKey ? this.selected : null;
  }
  health(): "ready" | "initializing" | "recovering" | "memory-blocked" {
    if (!this.baseConnection()) return this.ports.binding.snapshot()?.phase === "initializing" ? "initializing" : "recovering";
    if (!this.active || !this.selected?.enabled || !this.capabilitiesReady) return "recovering";
    return this.memoryReady ? "ready" : "memory-blocked";
  }
  private stop() {
    this.memoryReady = false; this.capabilitiesReady = false; this.preparationQueue.clear();
    this.lifetimeGeneration++; this.active = false; this.selected = null; this.baseKey = ""; this.configValue = null; this.inboxPage = null; this.preparationPage = null; this.workspaceInbox = null; this.reservationPage = null; this.answeredQueries.clear();
    for (const release of this.listeners.splice(0)) release(); this.publication.clear(); this.agentsKey = null; this.failures.clear(); this.intake.reset();
    this.inboxCursor = null; this.preparationCursor = null;
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
    const continuing = this.moreInbox || this.morePreparations;
    if (!continuing) this.pending = false;
    this.flight = Promise.resolve().then(() => this.scan(continuing)).then(success => {
      if (success === false) { this.scanFailures++; }
      else { this.scanFailures = 0; this.failures.delete("scan"); }
    }, error => {
      this.scanFailures++; this.pending = true;
      this.moreInbox = false; this.morePreparations = false;
      this.inboxCursor = null; this.preparationCursor = null; this.reportFailure("scan", error);
    }).finally(() => {
      this.flight = null;
      if (!this.closed && (this.pending || this.moreInbox || this.morePreparations)) {
        this.continuation = setTimeout(() => { this.continuation = null; this.next(); }, Math.min(30_000, 250 * 2 ** Math.min(this.scanFailures, 7)));
        this.continuation.unref();
      }
    });
  }
  private reportFailure(operation: "scan" | "agents" | "projects", error: unknown) {
    if (operation === "agents") this.capabilitiesReady = false;
    recoveryDiagnostics.record({ stage: operation === "agents" ? "capabilities" : "remote", code: "failed" });
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
    const { config, transport } = this.ports, crypto = this.ports.crypto(), header = { ...protocolHeader(config), expectedUserId: base.scope.userId,
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
      this.listeners.push(transport.watchRemote("remote/workspace:inbox", { ...header, connectionEpoch: base.connectionEpoch }, value => {
        if (this.lifetimeGeneration !== lifetime) return; this.workspaceInbox = value; this.wake();
      }, error => this.reportFailure("scan", error)));
      this.listeners.push(transport.watchRemote("remote/commands:inbox", { ...header, connectionEpoch: base.connectionEpoch, cursor: null }, value => {
        if (this.lifetimeGeneration !== lifetime) return; this.inboxPage = value; this.wake();
      }, failed));
      this.listeners.push(transport.watchRemote("remote/chats:preparations", { ...header, connectionEpoch: base.connectionEpoch, cursor: null }, value => {
        if (this.lifetimeGeneration !== lifetime) return; this.preparationPage = value; this.wake();
      }, failed));
      this.listeners.push(transport.watchRemote("remote/chats:reservations", { ...header, connectionEpoch: base.connectionEpoch, cursor: null }, value => {
        if (this.lifetimeGeneration !== lifetime) return; this.reservationPage = value; this.wake();
      }, failed));
    }
    const publicConfig = this.configValue ?? await transport.query("config:get", protocolHeader(config)); current();
    this.configValue = publicConfig;
    this.selected = { ...base, enabled: publicConfig.remoteControlEnabled, lifetimeGeneration: this.lifetimeGeneration };
    // Status and read-only inbox observation must survive a failed privacy reconciliation.
    if (!continuing) this.publishLater(current);
    const observedInbox = this.selected.enabled && (!continuing || this.moreInbox)
      ? ((!this.inboxCursor && this.inboxPage) || await transport.query("remote/commands:inbox", { ...header, connectionEpoch: base.connectionEpoch, cursor: this.inboxCursor })) : null;
    current();
    this.memoryReady = false;
    await this.ports.memoryBarrier?.beforeRemote(); current();
    this.memoryReady = true; recoveryDiagnostics.record({ stage: "remote", code: "ready" });
    this.queues.wake();
    if (this.selected?.enabled && (!continuing || this.morePreparations)) {
      const preparations = (!this.preparationCursor && this.preparationPage) || await transport.query("remote/chats:preparations", { ...header, connectionEpoch: base.connectionEpoch, cursor: this.preparationCursor }); current();
      if (!preparations.complete && (!preparations.cursor || preparations.cursor === this.preparationCursor)) throw new Error("remote-preparation-cursor");
      for (const head of preparations.items) {
        current(); if (head.ownerDeviceId === this.ports.deviceId && head.executionPreparation?.state === "pending") this.prepareLater(head.chat.id, current);
        current();
      }
      this.morePreparations = !preparations.complete;
      this.preparationCursor = preparations.complete ? null : preparations.cursor;
    }
    // U06 Q7-b: a reservation for an App this computer cannot edit is refused now, not after 30 minutes.
    if (this.selected?.enabled && !continuing) { await this.reservations.pass(header, base.connectionEpoch, this.reservationPage); current(); }
    current();
    // Nothing can be created for this device while remote control is disabled, so the inbox is not worth a query.
    if (!this.selected?.enabled) { this.inboxCursor = null; this.moreInbox = false; this.morePreparations = false; return; }
    if (!continuing && this.ports.workspaceReferences) {
      const queries = this.workspaceInbox ?? await transport.query("remote/workspace:inbox", { ...header, connectionEpoch: base.connectionEpoch }); current();
      const workspace = new RemoteWorkspaceService(this.ports.deviceId, this.ports.workspaceReferences);
      for (const id of [...this.answeredQueries]) if (!queries.some(row => row.request.queryId === id)) this.answeredQueries.delete(id);
      for (const row of queries) {
        if (this.answeredQueries.has(row.request.queryId)) continue;
        this.answeredQueries.add(row.request.queryId);
        try { await answerProjectQuery(row, { workspace, crypto, deviceId: this.ports.deviceId, connectionEpoch: base.connectionEpoch,
          current, report: input => transport.mutate("remote/workspace:report", { ...header, ...input }) }); }
        catch (error) { current(); this.reportFailure("scan", error); }
      }
    }
    if (continuing && !this.moreInbox) return;
    const page = observedInbox!; current();
    if (!page.complete && (!page.cursor || page.cursor === this.inboxCursor)) throw new Error("remote-inbox-cursor");
    const results = await Promise.allSettled(page.items.map(receipt => this.intake.receive(receipt)));
    current();
    const rejected = results.filter(result => result.status === "rejected");
    for (const failure of rejected) this.reportFailure("scan", failure.reason);
    /* One command that keeps failing is retried on its own; it must never stop this computer from publishing
       its Agents and folders, or every Chat on every other device reads "no Agent". */
    if (rejected.length) { this.moreInbox = true; return false; }
    this.inboxCursor = page.complete ? null : page.cursor;
    this.moreInbox = !page.complete;
  }
  private prepareLater(chatId: string, current: () => void) {
    if (this.preparations.has(chatId) || this.preparationQueue.has(chatId) || this.preparationQueue.size >= REMOTE_LIMITS.pageRows) return;
    this.preparationQueue.set(chatId, { current, generation: this.lifetimeGeneration });
    this.drainPreparations();
  }
  private drainPreparations() {
    while (this.preparations.size < 4 && this.preparationQueue.size) {
      const [chatId, { current, generation }] = this.preparationQueue.entries().next().value!;
      this.preparationQueue.delete(chatId);
      if (generation !== this.lifetimeGeneration || this.closed) continue;
      // The execution owner owns cancellation and persistence. A failed slot drains the next Chat, never its own immediate retry.
      const flight = Promise.resolve().then(() => { current(); return this.ports.execution.prepare(chatId); }).then(() => {
        current(); this.preparationPage = null; this.wake();
      }).catch(error => { if (this.lifetimeGeneration === generation) this.reportFailure("scan", error); }).finally(() => {
        if (this.preparations.get(chatId) === flight) this.preparations.delete(chatId);
        this.drainPreparations();
      });
      this.preparations.set(chatId, flight);
    }
  }
  private republish() {
    if (this.closed || !this.connection()) return;
    if (this.capabilityFlight) { this.capabilityDirty = true; return; }
    const lifetime = this.lifetimeGeneration, key = this.baseKey;
    this.publishLater(() => { if (this.lifetimeGeneration !== lifetime || hashChatContent(this.baseConnection()) !== key) throw new Error("connection-changed"); });
  }
  private publishLater(current: () => void) {
    if (this.capabilityFlight) return;
    this.capabilityDirty = false;
    const generation = this.lifetimeGeneration;
    const flight = this.publishCapabilities(current).catch(error => this.reportFailure("agents", error));
    this.capabilityFlight = flight;
    void flight.finally(() => {
      if (this.capabilityFlight === flight) this.capabilityFlight = null;
      if (!this.closed && this.lifetimeGeneration !== generation) this.wake();
      else if (this.capabilityDirty) this.republish();
    });
  }
  /* The catalog rides with the capabilities so a browser can offer the same models the desktop composer does. It is
     the list this desktop already knows: publishing never starts a probe (OPT-20 / B-06), so an idle desktop with remote
     control on spawns nothing. Until the composer here has read a catalog once, the Agent is offered without a model choice. */
  private async publishedModels(backend: AgentBackendId, runtime: InstalledSnapshot): Promise<RemoteModel[] | undefined> {
    const descriptor = backendById(backend);
    if (!descriptor.models?.cached || runtime.capabilities.modelOptions === "none") return undefined;
    try {
      const models = await descriptor.models.cached(runtime.runtime, this.ports.workspace());
      return models ? remoteModels(models) : undefined;
    } catch { return undefined; }
  }
  private async publishCapabilities(current: () => void) {
    const connection = this.connection(); if (!connection?.enabled) return;
    const { config, transport, settings, projects } = this.ports;
    const crypto = this.ports.crypto(), header = { ...protocolHeader(config), expectedUserId: connection.scope.userId, connectionEpoch: connection.connectionEpoch,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
    // Folder availability must not wait for Agent discovery or an optional model catalog publication.
    // Only changed facts are sent, a page per transaction, so a reconnect with twenty Projects costs one round trip (B-05).
    let projectFailed = false;
    const changed = projects.store.list().map(project => ({ projectId: project.id,
      bound: project.workspaceBinding.kind === "external" && projects.isUsable(project.id) }))
      .filter(item => this.publication.get(`project:${item.projectId}`) !== String(item.bound));
    for (let start = 0; start < changed.length; start += REMOTE_LIMITS.pageRows) {
      const page = changed.slice(start, start + REMOTE_LIMITS.pageRows);
      current();
      try {
        const { rejected } = await transport.mutate("remote/capabilities:projects", { ...header, projects: page }); current();
        for (const item of page) if (!rejected.includes(item.projectId)) this.publication.set(`project:${item.projectId}`, String(item.bound));
        if (rejected.length) { projectFailed = true; this.reportFailure("projects", new Error("project-unavailable")); }
      } catch (error) { current(); projectFailed = true; this.reportFailure("projects", error); }
    }
    if (!projectFailed) this.failures.delete("projects");
    const quotaRevision = this.ports.quota?.().revision ?? null;
    const agentsKey = JSON.stringify([this.agentInputs, quotaRevision, connection.connectionEpoch, crypto.keyPackageFingerprint, Math.floor(Date.now() / 600_000)]);
    if (agentsKey === this.agentsKey) return;
    try {
      // Published in the user's Settings › Providers order, so every remote picker lists Agents the way the desktop does. The remote wire
      // names built-ins only (until S5–S7), so a package or gone Provider in the stored order is never published.
      const published = settings.get().providerOrder.flatMap(id => knownBackend(builtinProviderCatalog, id) ?? []);
      const agents: RemoteAgentCapability[] = await Promise.all(published.map(async backend => {
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
      const memoryStatus = this.memoryFacade();
      const pluginCatalog = this.ports.plugins?.()?.catalog() ?? [];
      const digest = hashChatContent({ agents, memory: memoryStatus, plugins: pluginCatalog });
      if (this.publication.get("agents") !== digest) {
        const encrypted = await sealRemoteCapabilities(agents, connection.connectionEpoch, protocolHeader(config), crypto); current();
        const memory = memoryStatus && await sealRemoteMemory({ ...memoryStatus, publishedAt: Date.now() }, connection.connectionEpoch, protocolHeader(config), crypto); current();
        const plugins = await sealRemotePlugins(pluginCatalog, connection.connectionEpoch, protocolHeader(config), crypto); current();
        await transport.mutate("remote/capabilities:publish", { ...header, agents: encrypted, unlocked: true, memory, plugins }); current();
        this.publishedHeader = header; this.publication.set("agents", digest);
      }
      this.agentsKey = agentsKey; this.capabilitiesReady = true;
      this.failures.delete("agents");
    } catch (error) { current(); this.reportFailure("agents", error); }
  }
  /** Null while the setting is off: the server then drops the last status, so a phone never shows a stale one it was not meant to see. */
  private memoryFacade(): Omit<RemoteMemoryStatus, "publishedAt"> | null {
    const memory = this.ports.memory;
    if (!memory || !this.ports.settings.get().memoryPhoneFacade) return null;
    const status = memory.status(), facade = memoryFacadeState(status, status), key = `${facade.state}:${facade.issue}`;
    if (this.memorySince?.key !== key) this.memorySince = { key, at: Date.now() };
    // The phone learns only the hour of the last capture: enough to say "today", too coarse to trace what was said when.
    const lastCaptureAt = status.lastCaptureAt === null ? null : status.lastCaptureAt - (status.lastCaptureAt % 3_600_000);
    return { schema: "bottega.remote-memory/v1", ...facade, since: this.memorySince.at, lastCaptureAt };
  }
  async suspend() {
    const header = this.publishedHeader; this.publishedHeader = null; this.stop(); try { this.ports.clock().invalidate(); } catch { /* Locked key owners have already invalidated their clock. */ }
    if (header && this.ports.account.remoteConnection() === header.connectionEpoch && this.ports.account.connectionIdentity().profile?.userId === header.expectedUserId)
      await this.ports.transport.mutate("remote/capabilities:publish", { ...header, agents: [], unlocked: false }).catch(error => this.reportFailure("agents", error));
    await this.intake.settled();
  }
  async close() { this.closed = true; await this.queues.close(); clearInterval(this.timer); this.releaseAccount(); this.releaseRemoteReady(); this.releaseAgentInputs(); this.releaseConnection(); this.releaseAuthority(); this.releaseTransferred(); await this.suspend(); await this.flight; await this.capabilityFlight; await this.intake.settled(); }
}
