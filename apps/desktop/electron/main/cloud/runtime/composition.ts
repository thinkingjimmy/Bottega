/**
 * [INPUT]: The PreparedCloudRuntime shape from prepare.ts, Electron account/lifecycle ports, isolated userData, original coordinator/control owners and artifact custody/publication.
 * [OUTPUT]: Wires binding-fenced offline identity, a read-only operation-receipt lookup for the broker, startup/token admission, synchronization, scoped artifact transfers, sleep/quit presence (resume is refreshed by the application lifecycle), continuation, remote IPC and the `attachAccountConfig(store)` Dock-layout sync seam onto an already prepared runtime, with verified owner/account record resource ports, Agent-configuration sync, the Workflow projection outbox and the resource-command executor attached alongside, behind one shared Memory reconnect barrier.
 * [POS]: Heavy half of the cloud composition, dynamically loaded and never reached from prepare.ts; stable builds exclude the implementation and SDK.
 */
import { recordResourcePort } from "../remote/resources/records";
import { MemoryControlBarrier } from "../remote/memory/runtime";
import { attachPreviewCloud } from "../../preview/session/cloud";
import { NativePluginSurfaces } from "../sync/surfaces/native";
import { artifactRuntime } from "../../artifacts/runtime";
import { artifactCloudTransport } from "../../artifacts/storage/transport";
import { app, powerMonitor, shell, type BrowserWindow } from "electron";
import { SessionClient } from "../account/session-client";
import { initialDeviceName } from "../account/device-name";
import { machineIdFor } from "../../machine/machine-id";
import { AccountAvatarCache } from "../account/avatar";
import { acceptsCloudCallback, configureLoginReturn } from "../account/protocol-handler";
import { installCloudCallbackInbox } from "../bootstrap/callback-events";
import { CloudTransport } from "./transport/transport";
import { protocolHeader } from "@ai-chat/cloud-protocol/config";
import type { CloudReceiptQuery } from "../../operations/families";
import { CloudAccountService } from "./service";
import { registerCloudAccount } from "./registration";
import type { ChatsService } from "../../chats/service/chats-service";
import type { ChatMetadata } from "../../chats/projection/chat-summary";
import { InitialSyncController } from "../sync/initial/controller";
import { DesktopSyncRun } from "../sync/initial/run";
import { desktopFileTransport } from "../files/transport";
import { DesktopBlobStore } from "../files/store";
import { AttachmentStore } from "../../chats/attachments/attachment-store";
import { memoryBlobSource, type ChatBodyBytePorts } from "../sync/chats/bodies";
import { syncStoreEvents, type SyncEventPorts } from "./store-events";
import type { GalleryMediaService } from "../../gallery/media-service";
import { LocalTurnRecorder, type TurnRuntimePorts } from "../remote/recorder";
import { RemoteArtifacts } from "../../artifacts/remote";
import { CloudChatReader } from "../chat/reader";
import { registerCloudChat } from "../chat/registration";
import { CloudExecutionService } from "../execution/service";
import type { ProjectsService } from "../../projects/projects-service";
import { bindCloudProject } from "../../projects/rebind/cloud-binding";
import { RecoveryContent } from "../chat/recovery/content";
import { RecoverySave } from "../chat/recovery/save";
import { BaseImageReader } from "../sync/bases/images";
import { CloudBaseReview } from "../bases/review";
import { registerCloudBaseReview } from "../bases/registration";
import type { BasePromotionService } from "../../bases/base-promotion-service";
import type { SaveAsAppService } from "../../apps/conversion/save-as-app";
import { DesktopBaseConversion } from "../sync/conversion/base";
import { DesktopProjectRescue } from "../sync/conversion/rescue";
import type { ProjectRescueService } from "../../projects/rescue/service";
import { CloudConversionReview } from "../sync/apps/review";
import { registerCloudConversion } from "../sync/apps/registration";
import { createCloudApps } from "../apps/composition";
import { registerCloudApps } from "../apps/registration";
import type { CloudAppsService } from "../apps/service";
import { CloudChatRemoval } from "../chat/deletion/removal";
import { CloudProjectRemoval } from "../sync/deletion/projects/removal";
import { RemoteCommandRuntime } from "../remote/commands/runtime";
import { RemoteCommandClient } from "../remote/commands/client";
import { registerCloudRemote } from "../remote/commands/registration";
import type { ConversationCoordinator } from "../../sections/coordinator/conversation-coordinator";
import type { SettingsStore } from "../../settings/settings-store";
import type { TurnRegistry } from "../../agent/turns/turn/turn-registry";
import type { AgentTurn } from "../../backends/types";
import { composeSyncEncryption } from "../encryption/composition";
import type { PreparedCloudRuntime } from "./prepare";
import type { UnifiedSkillsService } from "../../skills-management/service";
import { RemoteActivityObserver, type RemoteActivityPort } from "../remote/activity";
import { AccountConfigSyncCoordinator, type AccountConfigSyncHandle } from "../sync/account-config/coordinator";
import type { DockConfigStore } from "../../system-dock/store/config-store";
import { attachAgentConfigSync } from "../../agent-configs/runtime";
import { attachWorkflowProjection } from "../../workflows/projection/attach";
import { ResourceCommandRuntime } from "../remote/resources/runtime";
import { workflowResourcePort } from "../remote/resources/workflows";
import { appResourcePort, type RemoteApps } from "../remote/resources/apps";
import { ledgerActivityReason } from "../../sections/coordinator/agent-switch/activity";
/* Device registration and folder ownership are compared with each other by the server, so they share the cloud purpose. */
const machineIdHash = machineIdFor("cloud");
export async function createCloudRuntime(prepared: PreparedCloudRuntime, focus: () => void,
  ui: { recordPlugins?: () => import("../../plugins/records/service").RecordPluginService | null; pluginSurfaces?: () => import("../sync/surfaces/source").PluginSurfaceSource | null; activity?: RemoteActivityPort; skills?: UnifiedSkillsService; events: SyncEventPorts & { chats: Pick<ChatsService, "configureCloudRemoval" | "preflightChatFork" | "forkChat"> }; gallery: Pick<GalleryMediaService, "readForSynchronization">; turns: TurnRuntimePorts & { turns: TurnRegistry<AgentTurn> }; remote: { workspaceReferences?: import("../remote/commands/input/references").RemoteWorkspacePorts; coordinator: ConversationCoordinator; settings: SettingsStore; quota?(): import("../../../../shared/usage-limits/types").UsageLimitsSnapshot; usage?: Pick<import("../../usage-limits/service").AgentUsageLimitsService, "known" | "refreshRemote">; memory?: import("../remote/commands/runtime").RemoteRuntimePorts["memory"]; workspace(): string; publishRecord?(record: ChatMetadata): void }; projectGate: ProjectsService; apps?: () => RemoteApps | null; buildStatus?: () => import("../../apps/service/consent/build-status").AppBuildTracker | null; saveAsApp: SaveAsAppService; promotion: BasePromotionService; rescue: ProjectRescueService }) {
  const { config, vault, deviceId, binding, scope, owners, userData, lifecycle } = prepared;
  if (!scope || !owners || !lifecycle || !prepared.appInstall) throw new Error("SYNC_OWNERS_NOT_ATTACHED");
  if (ui.skills) owners.skills = ui.skills;
  const http = new SessionClient(config, () => vault.session());
  const transport = new CloudTransport(config, force => http.getToken(force));
  const returnMode = configureLoginReturn(app, config.callbackScheme);
  const service = new CloudAccountService({ config, vault, http, transport, returnMode,
    deviceId, binding, scope, version: app.getVersion(),
    platform: process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux",
    name: initialDeviceName, machineIdHash, libraryId: () => ui.remote.settings.get().libraryId ?? null,
    openBrowser: url => shell.openExternal(url),
    deviceNames: (userId, devices) => { if (binding.snapshot()?.userId === userId) owners.chats.sync.setDeviceNames(devices); } });
  let closingFlight: Promise<void> | null = null;
  const reportQuit = () => (closingFlight ??= service.reportOffline("quit").catch(() => {}));
  const sleep = () => { void service.reportOffline("sleep").catch(() => {}); }, quit = (event: { defaultPrevented: boolean }) => {
    queueMicrotask(() => { if (!event.defaultPrevented) void reportQuit(); });
  };
  // `before-quit` already reported offline; awaiting that same flight avoids a second heartbeat.
  const reportClosing = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([reportQuit(), new Promise<void>(resolve => { timer = setTimeout(resolve, 2_000); })]); }
    finally { if (timer) clearTimeout(timer); }
  };
  // Resume is refreshed once through presence/lifecycle/application.ts -> index.ts.
  powerMonitor.on("suspend", sleep); app.on("before-quit", quit);
  const contentCrypto = () => encryption.owner.contentPort();
  artifactRuntime()?.publisher.configure(() => {
    const admitted = binding.snapshot();
    if (!admitted || admitted.phase !== "active" || admitted.paused || service.snapshot().status !== "ready") return null;
    const crypto = contentCrypto(), artifacts = artifactRuntime()!;
    return artifactCloudTransport({ root: artifacts.root, custody: artifacts.custody, config, crypto, transport,
      filePorts: desktopFileTransport({ config, userId: admitted.userId, transport, crypto: contentCrypto, token: () => http.getToken() }),
      current: () => { const current = binding.snapshot();
        if (!current || current.userId !== admitted.userId || current.manifestId !== admitted.manifestId || current.phase !== "active" || current.paused || contentCrypto().keyPackageFingerprint !== crypto.keyPackageFingerprint) throw new Error("artifact-account-changed");
      } });
  });
  let chatReader: CloudChatReader | null = null;
  let baseReview: CloudBaseReview | null = null;
  let cloudApps: CloudAppsService | null = null;
  const attachments = new AttachmentStore(() => ui.remote.settings.get().libraryRoot ?? null), publish = syncStoreEvents(owners, ui.events);
  let remoteActivity: RemoteActivityObserver | null = null;
  const dataChanged = () => { publish(); remoteActivity?.wake(); chatReader?.changed(); baseReview?.changed(); cloudApps?.changed(); };
  const removal = { config, binding, transport, crypto: contentCrypto, account: () => service.snapshot(), changed: dataChanged,
    own: (activity: { close(): Promise<void> }) => scope.ownLocal(activity) };
  const chatRemoval = new CloudChatRemoval({ ...removal, store: owners.chats.sync });
  const projectRemoval = new CloudProjectRemoval({ ...removal, store: owners.projects });
  ui.events.chats.configureCloudRemoval(id => chatRemoval.prepare(id));
  ui.projectGate.configureCloudRemoval(id => projectRemoval.prepare(id));
  cloudApps = createCloudApps(prepared.appInstall, { config, crypto: contentCrypto, binding, owners, journal: lifecycle.journal, userData, transport,
    openRetained: async path => { const error = await shell.openPath(path); if (error) throw new Error("APP_REMOVAL_ARCHIVE_UNAVAILABLE"); },
    account: () => service.snapshot(), own: activity => scope.own(activity), ownLocal: activity => scope.ownLocal(activity), changed: dataChanged,
    filePorts: userId => desktopFileTransport({ config, userId, transport, crypto: contentCrypto, token: () => http.getToken() }) });
  const conversion = new DesktopBaseConversion({ crypto: contentCrypto, config, deviceId, binding, owners, journal: lifecycle.journal,
    account: () => service.snapshot(), transport, own: activity => scope.own(activity), changed: dataChanged });
  ui.saveAsApp.attachCloud(conversion);
  ui.promotion.attachCloud({ prepare: input => conversion.prepareProject(input), commit: proof => conversion.commit(proof),
    discard: (intent, hash, record) => conversion.discard(intent, hash, record) });
  ui.rescue.attachCloud(new DesktopProjectRescue({ crypto: contentCrypto, config, deviceId, binding, owners, journal: lifecycle.journal,
    account: () => service.snapshot(), transport, own: activity => scope.own(activity), changed: dataChanged }));
  let recoveringPromotion: Promise<void> | null = null;
  const recoverPromotions = () => {
    if (recoveringPromotion || service.snapshot().status !== "ready" || binding.snapshot()?.phase !== "active" || binding.snapshot()?.paused) return;
    recoveringPromotion = Promise.allSettled([ui.saveAsApp.recoverPending(), ui.promotion.recoverPending(), ui.rescue.recoverPending()]).then(() => {}).finally(() => { recoveringPromotion = null; });
  };
  /* The retry only has work for a ready account, so a signed-out or offline desktop holds no timer (C-29). */
  let promotionTimer: ReturnType<typeof setInterval> | null = null;
  const armPromotions = () => {
    const ready = service.snapshot().status === "ready";
    if (ready && !promotionTimer) { promotionTimer = setInterval(recoverPromotions, 5000); promotionTimer.unref(); }
    else if (!ready && promotionTimer) { clearInterval(promotionTimer); promotionTimer = null; }
  };
  armPromotions();
  const conversionReview = new CloudConversionReview({ environmentId: config.environmentId, binding, account: service, journal: lifecycle.journal, chats: owners.chats, service: ui.saveAsApp, promotion: ui.promotion, rescue: ui.rescue });
  baseReview = new CloudBaseReview({ config, binding, account: service, store: owners.bases,
    recovery: { projects: owners.projects, gate: lifecycle.gate }, own: activity => scope.ownLocal(activity), changed: dataChanged });
  const chatBytes: Omit<ChatBodyBytePorts, "files"> = { attachments, media: async input => {
    const source = await ui.gallery.readForSynchronization(input.part.mediaSource ?? { kind: "transcript", chatId: input.chatId,
      incarnationId: input.incarnationId, assistantSeq: input.message.seq, itemId: input.part.itemId }, input.subagentId);
    return { source: memoryBlobSource(source.bytes, source.mime), close: async () => {} };
  } };
  const recovery = new RecoveryContent(owners.chats.sync, chatBytes, userData);
  const recoverySave = new RecoverySave({ content: recovery, chats: owners.chats, homes: owners.homes, gate: lifecycle.gate,
    own: activity => scope.ownLocal(activity), changed: dataChanged, current: expected => {
      const current = binding.snapshot(), account = service.snapshot();
      if (!current || current.phase === "closing" || current.userId !== expected.userId || config.environmentId !== expected.environment ||
        account.profile?.userId !== current.userId || !["ready", "temporarily-offline"].includes(account.status)) throw new Error("RECOVERY_ACCOUNT_CHANGED");
    } });
  const recorder = new LocalTurnRecorder({ ...ui.turns, store: owners.chats, binding, config, deviceId });
  const assertIdle = (chatId: string) => {
    if (ui.turns.turns.liveEntries().some(entry => entry.conversationId === chatId && (!entry.effectiveTerminal || entry.cleanup !== "complete" || !["stored", "empty", "missing"].includes(entry.persist))) ||
      ledgerActivityReason(ui.turns.ledger, chatId)) throw new Error("LOCAL_EXECUTION_UNCONFIRMED");
  };
  const sync = new InitialSyncController({ config, userData, binding, scope, owners, account: () => service.snapshot(), changed: value => service.updateSync(value),
    createRun: changed => {
      const userId = binding.snapshot()!.userId;
      return new DesktopSyncRun({ config, crypto: contentCrypto, userData, deviceId, owners, binding, transport, changed, dataChanged, recorder, promotion: ui.promotion, recovery: recoverySave, assertIdle,
        retireApp: prepared.appInstall!.settleDeletion, plugins: () => ui.pluginSurfaces?.() ?? null, buildStatus: () => ui.buildStatus?.() ?? null,
        folder: { id: () => ui.remote.settings.get().libraryId ?? null, root: () => owners.homes.libraryRoot, machineIdHash },
        filePorts: desktopFileTransport({ config, userId, transport, crypto: contentCrypto, token: () => http.getToken() }), bytes: chatBytes });
    } });
  chatReader = new CloudChatReader({ crypto: contentCrypto, config, userData, binding, account: service, store: owners.chats.sync, transport, recovery, projectRemoval, factsChanged: dataChanged,
    libraryRoot: () => owners.homes.libraryRoot,
    filePorts: userId => desktopFileTransport({ config, userId, transport, crypto: contentCrypto, token: () => http.getToken() }), openChat: chatId => sync.openChat(chatId), own: activity => scope.own(activity) });
  const artifacts = artifactRuntime();
  if (artifacts) artifacts.remote = new RemoteArtifacts(chatReader, () => {
    const port = contentCrypto(); return JSON.stringify([port.session.userId, port.scope, port.keyPackageFingerprint]);
  });
  const baseImages = new BaseImageReader({ config, userData, store: owners.bases, binding, account: service,
    filePorts: userId => desktopFileTransport({ config, userId, transport, crypto: contentCrypto, token: () => http.getToken() }), own: activity => scope.own(activity) });
  const execution = new CloudExecutionService({ config, userData, deviceId, binding, owners, ...lifecycle, attachments, runtime: ui.turns, projectGate: ui.projectGate,
    account: service, transport, recovery: recoverySave, filePorts: userId => desktopFileTransport({ config, userId, transport, crypto: contentCrypto, token: () => http.getToken() }), own: activity => scope.own(activity), changed: dataChanged,
    bindProject: (id, identity, current) => bindCloudProject(ui.projectGate, id, identity, current), homeCapture: prepared.homeCapture });
  const memoryBarrier = new MemoryControlBarrier({ config, deviceId, binding, account: service, transport, crypto: contentCrypto,
    memory: ui.remote.memory ?? { facadeEnabled: () => false, applyPaused: async () => { throw new Error("memory-not-enabled"); } } });
  const remote = new RemoteCommandRuntime({ memoryBarrier, plugins: () => ui.pluginSurfaces?.() ?? null, liveHead: chatId => chatReader?.liveHead(chatId), apps: () => ui.apps?.() ?? null, crypto: contentCrypto, clock: () => encryption.owner.clock(), config, deviceId, binding, transport, account: service, store: owners.chats, projects: ui.projectGate,
    files: userId => new DesktopBlobStore(userData, { ...config, userId }, desktopFileTransport({ config, userId, transport, crypto: contentCrypto, token: () => http.getToken() })),
    ...ui.remote, ...ui.turns, forks: ui.events.chats, execution, own: activity => scope.own(activity) });
  /* P13 R-24 / R-32: a phone or Web asks this computer to act on its workflows or read a Provider's quota again. */
  const resources = new ResourceCommandRuntime({ memoryBarrier, config, deviceId, binding, account: service, transport, crypto: contentCrypto, workflows: workflowResourcePort, apps: appResourcePort(() => ui.apps?.() ?? null),
    records: recordResourcePort({ bases: owners.bases, records: () => ui.recordPlugins?.() ?? null, environment: config.environmentId,
      current: userId => { const active = binding.snapshot(), account = service.snapshot();
        return active?.userId === userId && active.phase === "active" && !active.paused && account.status === "ready" && account.profile?.userId === userId; },
      owns: async (owner, userId) => {
        if (owner.kind === "project") {
          const sync = owners.projects.get(owner.projectId)?.sync;
          return Boolean(sync && !sync.deleted && sync.scope.environment === config.environmentId && sync.scope.userId === userId && sync.confirmed?.sourceDeviceId === deviceId);
        }
        const head = await chatReader?.head(owner.chatId);
        return Boolean(head && head.ownerDeviceId === deviceId && head.chat.incarnationId === owner.incarnationId);
      } }),
    deviceName: id => owners.chats.sync.deviceName(id),
    quota: { known: provider => ui.remote.usage?.known(provider) ?? false, refresh: provider => ui.remote.usage?.known(provider) ? ui.remote.usage.refreshRemote(provider) : Promise.resolve() },
    onQuotaRefreshed: () => remote.wake(), own: activity => scope.own(activity),
    report: error => console.warn("[resources] command failed", error instanceof Error ? error.message : String(error)) });
  const remoteClient = new RemoteCommandClient({ crypto: contentCrypto, clock: () => encryption.owner.clock(), config, deviceId, binding, transport, account: service, own: activity => scope.own(activity),
    files: userId => new DesktopBlobStore(userData, { ...config, userId }, desktopFileTransport({ config, userId, transport, crypto: contentCrypto, token: () => http.getToken() })) });
  let namesUserId: string | null = null;
  const avatars = new AccountAvatarCache(userData);
  const encryption = await composeSyncEncryption({ config, userData, deviceId, service, transport, binding, scope, sync, onSyncEnabled: initial => initial ? ui.remote.settings.setTrusted({ keepRunningInBackground: true }).then(() => {}) : Promise.resolve() });
  if (ui.activity) remoteActivity = new RemoteActivityObserver({ store: owners.chats.sync, activity: ui.activity, deviceId,
    exists: id => Boolean(owners.chats.getIncarnationId(id)), scope: () => {
      const account = service.snapshot(), selected = binding.snapshot();
      return selected?.phase === "active" && !selected.paused && account.profile?.userId === selected.userId && ["ready", "temporarily-offline"].includes(account.status)
        ? { environment: config.environmentId, userId: selected.userId } : null;
    } });
  service.attachSync(sync); const unsubscribeSync = service.subscribe(value => {
    const userId = value.profile?.userId ?? null;
    if (value.profile || ["signed-out", "signing-out", "revoked", "deleting"].includes(value.status)) avatars.select(value.profile, dataUrl => service.updateAvatar(userId, dataUrl));
    if (userId !== namesUserId) { owners.chats.sync.clearDeviceNames(); namesUserId = userId; }
    sync.accountChanged(); remoteActivity?.wake();
    void encryption.owner.accountChanged().catch(() => {});
    void cloudApps?.accountChanged().catch(() => undefined);
    armPromotions(); recoverPromotions();
  });
  const inbox = installCloudCallbackInbox(app, config.callbackScheme);
  const onProtocolArgs = (argv: readonly string[]) => {
    if (argv.some(url => acceptsCloudCallback(url, config.callbackScheme, service.login.state))) focus();
  };
  // Startup remains usable while an unavailable cloud is retried in the background.
  void service.initialize().then(() => { inbox.bind(url => onProtocolArgs([url])); onProtocolArgs(process.argv); });
  await service.localIdentityReady;
  let accountConfig: AccountConfigSyncHandle | null = null;
  /* Agent configurations (TASK-12): their store is composed before the cloud runtime and works signed out; sync shares the
     account connection, the content cipher and the scope fence, and closes before them. */
  const agentConfigs = attachAgentConfigSync({ config, deviceId, binding, account: service, transport, crypto: contentCrypto, own: activity => scope.own(activity) });
  const previews = attachPreviewCloud({ config, deviceId, binding, account: service, transport, crypto: contentCrypto, own: activity => scope.own(activity) });
  /* The Workflow outbox (P13): this computer's runs, needs-you items and bindings, mirrored for phones and Web while signed in. */
  const workflowProjection = attachWorkflowProjection({ config, deviceId, binding, account: service, transport, crypto: contentCrypto, own: activity => scope.own(activity) });
  /* The one account-config synchronizer. The Dock runtime owns its store and attaches it once; the returned handle
     serves Settings → Dock status and conflict choices and closes before the account connection does. */
  const attachAccountConfig = (store: DockConfigStore): AccountConfigSyncHandle => {
    if (accountConfig) throw new Error("ACCOUNT_CONFIG_ALREADY_ATTACHED");
    const cleanup = prepared.accountConfig.attach(store);
    const coordinator = new AccountConfigSyncCoordinator({ config, deviceId, binding, account: service, transport, crypto: contentCrypto, store,
      own: activity => scope.own(activity), ready: cleanup.settled });
    const handle: AccountConfigSyncHandle = { status: () => coordinator.status(), onChanged: listener => coordinator.onChanged(listener),
      resolveConflict: choice => coordinator.resolveConflict(choice), wake: () => coordinator.wake(),
      close: async () => { await coordinator.close(); cleanup.detach(); if (accountConfig === handle) accountConfig = null; } };
    return accountConfig = handle;
  };
  /* Read-only receipt lookup for the operation broker; it answers only for the active account and key package. */
  const receipt = async (name: CloudReceiptQuery, operationId: string) => {
    const current = binding.snapshot(); if (!current || current.phase !== "active") throw new Error("cloud-account-not-active");
    const crypto = contentCrypto();
    return transport.query(name, { ...protocolHeader(config), expectedUserId: current.userId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint }, operationId });
  };
  const pluginSurfaces = new NativePluginSurfaces({config,crypto:contentCrypto,transport,
    confirmedHead:chatId=>chatReader!.head(chatId),ownerDevice:id=>{const value=service.computers();return value.kind==="computers"&&value.computers.some(computer=>computer.installations.some(device=>device.deviceId===id&&device.state==="active"));},subscribe:listener=>service.subscribe(listener),
    own:activity=>scope.own(activity),files:userId=>desktopFileTransport({config,userId,transport,crypto:contentCrypto,token:()=>http.getToken()}),current:()=>{
      const current=binding.snapshot(),account=service.snapshot();
      if(!current||current.phase!=="active"||current.paused||account.status!=="ready"||account.profile?.userId!==current.userId)throw new Error("PLUGIN_ACCOUNT_UNAVAILABLE");
    }});
  return { openPluginSurface:pluginSurfaces.open.bind(pluginSurfaces),assertPluginDraft:pluginSurfaces.assertDraft.bind(pluginSurfaces),
    subscribeIdentity:(listener:()=>void)=>service.subscribe(listener),attachAccountConfig, receipt, register: (window: BrowserWindow, rendererUrl: string) => {
    registerCloudAccount(service, window, rendererUrl); registerCloudChat(chatReader!, execution, window, rendererUrl); registerCloudBaseReview(baseReview!, window, rendererUrl);
    registerCloudConversion(conversionReview, rendererUrl);
    registerCloudApps(cloudApps!, window, rendererUrl);
    registerCloudRemote(remoteClient, window, rendererUrl);
  }, onProtocolArgs, refresh: () => service.refresh(true),
    /** Read-only: who is signed in on this computer (the verified operator of a workflow confirmation). */
    accountIdentity: () => service.connectionIdentity(), close: async () => { await previews.close(); await accountConfig?.close(); await agentConfigs?.close(); await workflowProjection.close(); await resources.close(); await memoryBarrier.close(); await remoteActivity?.close(); await reportClosing(); powerMonitor.removeListener("suspend", sleep); app.removeListener("before-quit", quit); if (promotionTimer) clearInterval(promotionTimer); inbox.close(); unsubscribeSync(); await encryption.close(); await remote.close(); avatars.close(); await avatars.settled(); await cloudApps?.close(); await execution.close(); await chatReader?.close(); await baseImages.close(); baseReview?.close(); service.close(); await service.login.drain(); await vault.drain(); await sync.close(); await recorder.close(); await prepared.homeCapture?.close(); await scope.close(); await recoveringPromotion; await binding.close(); } };
}
