/**
 * [INPUT]: The PreparedCloudRuntime shape from prepare.ts, Electron account/lifecycle ports, isolated userData, original coordinator/control owners and artifact custody/publication.
 * [OUTPUT]: Wires binding-fenced offline identity, startup/token admission, synchronization, scoped artifact transfers, sleep/quit presence (resume is refreshed by the application lifecycle), continuation and remote IPC onto an already prepared runtime.
 * [POS]: Heavy half of the cloud composition, dynamically loaded and never reached from prepare.ts; stable builds exclude the implementation and SDK.
 */
import { artifactRuntime } from "../../artifacts/runtime";
import { artifactCloudTransport } from "../../artifacts/storage/transport";
import { app, powerMonitor, shell, type BrowserWindow } from "electron";
import { SessionClient } from "../account/session-client";
import { initialDeviceName } from "../account/device-name";
import { AccountAvatarCache } from "../account/avatar";
import { acceptsCloudCallback, configureLoginReturn } from "../account/protocol-handler";
import { installCloudCallbackInbox } from "../bootstrap/callback-events";
import { CloudTransport } from "./transport";
import { CloudAccountService } from "./service";
import { registerCloudAccount } from "./registration";
import type { ChatsService } from "../../chats/chats-service";
import type { ChatMetadata } from "../../chats/chat-summary";
import { InitialSyncController } from "../sync/initial/controller";
import { DesktopSyncRun } from "../sync/initial/run";
import { desktopFileTransport } from "../files/transport";
import { DesktopBlobStore } from "../files/store";
import { AttachmentStore } from "../../chats/attachment-store";
import { memoryBlobSource, type ChatBodyBytePorts } from "../sync/chats/bodies";
import { syncStoreEvents, type SyncEventPorts } from "./store-events";
import type { GalleryMediaService } from "../../gallery/media-service";
import { LocalTurnRecorder, type TurnRuntimePorts } from "../remote/recorder";
import { RemoteArtifacts } from "../../artifacts/remote";
import { CloudChatReader } from "../chat/reader";
import { registerCloudChat } from "../chat/registration";
import { CloudExecutorService } from "../executor/service";
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
import type { SettingsStore } from "../../settings-store";
import type { TurnRegistry } from "../../turn-registry";
import type { AgentTurn } from "../../backends/types";
import { composeSyncEncryption } from "../encryption/composition";
import type { PreparedCloudRuntime } from "./prepare";
import type { UnifiedSkillsService } from "../../skills-management/service";
import { RemoteActivityObserver, type RemoteActivityPort } from "../remote/activity";
import { ledgerActivityReason } from "../../sections/coordinator/agent-switch/activity";
export async function createCloudRuntime(prepared: PreparedCloudRuntime, focus: () => void,
  ui: { activity?: RemoteActivityPort; skills?: UnifiedSkillsService; events: SyncEventPorts & { chats: Pick<ChatsService, "configureCloudRemoval" | "preflightChatFork" | "forkChat"> }; gallery: Pick<GalleryMediaService, "readForSynchronization">; turns: TurnRuntimePorts & { turns: TurnRegistry<AgentTurn> }; remote: { workspaceReferences?: import("../remote/commands/input/references").RemoteWorkspacePorts; coordinator: ConversationCoordinator; settings: SettingsStore; quotaDemand?(active: boolean): void; quota?(): import("../../../../shared/usage-limits/types").UsageLimitsSnapshot; workspace(): string; publishRecord?(record: ChatMetadata): void }; projectGate: ProjectsService; saveAsApp: SaveAsAppService; promotion: BasePromotionService; rescue: ProjectRescueService }) {
  const { config, vault, deviceId, binding, scope, owners, userData, lifecycle } = prepared;
  if (!scope || !owners || !lifecycle || !prepared.appInstall) throw new Error("SYNC_OWNERS_NOT_ATTACHED");
  if (ui.skills) owners.skills = ui.skills;
  const http = new SessionClient(config, () => vault.session());
  const transport = new CloudTransport(config, force => http.getToken(force));
  const returnMode = configureLoginReturn(app, config.callbackScheme);
  const service = new CloudAccountService({ config, vault, http, transport, returnMode,
    deviceId, binding, scope, version: app.getVersion(),
    platform: process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux",
    name: initialDeviceName, openBrowser: url => shell.openExternal(url),
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
  const promotionTimer = setInterval(recoverPromotions, 5000); promotionTimer.unref();
  const conversionReview = new CloudConversionReview({ environmentId: config.environmentId, binding, account: service, journal: lifecycle.journal, chats: owners.chats, service: ui.saveAsApp, promotion: ui.promotion, rescue: ui.rescue });
  baseReview = new CloudBaseReview({ config, binding, account: service, store: owners.bases,
    recovery: { projects: owners.projects, gate: lifecycle.gate }, own: activity => scope.ownLocal(activity), changed: dataChanged });
  const chatBytes: Omit<ChatBodyBytePorts, "files"> = { attachments, media: async input => {
    const source = await ui.gallery.readForSynchronization(input.part.mediaSource ?? { kind: "transcript", chatId: input.chatId,
      incarnationId: input.incarnationId, assistantSeq: input.message.seq, itemId: input.part.itemId }, input.subagentId);
    return { source: memoryBlobSource(source.bytes, source.mime), close: async () => {} };
  } };
  const recovery = new RecoveryContent(owners.chats.sync, config, chatBytes, userData);
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
        retireApp: prepared.appInstall!.settleDeletion,
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
  const executor = new CloudExecutorService({ config, userData, deviceId, binding, owners, ...lifecycle, attachments, runtime: ui.turns, projectGate: ui.projectGate,
    account: service, transport, recovery: recoverySave, filePorts: userId => desktopFileTransport({ config, userId, transport, crypto: contentCrypto, token: () => http.getToken() }), own: activity => scope.own(activity), changed: dataChanged,
    bindProject: (id, identity, current) => bindCloudProject(ui.projectGate, id, identity, current) });
  const remote = new RemoteCommandRuntime({ crypto: contentCrypto, clock: () => encryption.owner.clock(), config, deviceId, binding, transport, account: service, store: owners.chats, projects: ui.projectGate,
    files: userId => new DesktopBlobStore(userData, { ...config, userId }, desktopFileTransport({ config, userId, transport, crypto: contentCrypto, token: () => http.getToken() })),
    ...ui.remote, ...ui.turns, forks: ui.events.chats, executor, own: activity => scope.own(activity) });
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
    recoverPromotions();
  });
  const inbox = installCloudCallbackInbox(app, config.callbackScheme);
  const onProtocolArgs = (argv: readonly string[]) => {
    if (argv.some(url => acceptsCloudCallback(url, config.callbackScheme, service.login.state))) focus();
  };
  // Startup remains usable while an unavailable cloud is retried in the background.
  void service.initialize().then(() => { inbox.bind(url => onProtocolArgs([url])); onProtocolArgs(process.argv); });
  await service.localIdentityReady;
  return { register: (window: BrowserWindow, rendererUrl: string) => {
    registerCloudAccount(service, window, rendererUrl); registerCloudChat(chatReader!, executor, window, rendererUrl); registerCloudBaseReview(baseReview!, window, rendererUrl);
    registerCloudConversion(conversionReview, rendererUrl);
    registerCloudApps(cloudApps!, window, rendererUrl);
    registerCloudRemote(remoteClient, window, rendererUrl);
  }, onProtocolArgs, refresh: () => service.refresh(true), close: async () => { await remoteActivity?.close(); await reportClosing(); powerMonitor.removeListener("suspend", sleep); app.removeListener("before-quit", quit); clearInterval(promotionTimer); inbox.close(); unsubscribeSync(); await encryption.close(); await remote.close(); avatars.close(); await avatars.settled(); await cloudApps?.close(); await executor.close(); await chatReader?.close(); await baseImages.close(); baseReview?.close(); service.close(); await service.login.drain(); await vault.drain(); await sync.close(); await recorder.close(); await prepared.homeCapture?.close(); await scope.close(); await recoveringPromotion; await binding.close(); } };
}
