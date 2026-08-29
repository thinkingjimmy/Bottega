/**
 * [INPUT]: Depends on Electron contextBridge/ipcRenderer/webUtils, the closure-free RTC frame policy, and all shared renderer IPC contracts
 * [OUTPUT]: Denies WebRTC in every frame main world, then exposes sandboxed typed product bridges, including exact-Project Tools and scoped MCP APIs, only in the top frame
 * [POS]: All-frame preload security boundary; OOPIF/srcdoc frames receive RTC denial but no Electron, Node, IPC, path, secret, or product bridge
 */

import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent,
} from "electron";
import { APP_CHANNEL, type AppBridgeApi } from "../../shared/app-ipc";
import {
  APPS_CHANNEL,
  type AddAppInput,
  type AppsBridgeApi,
} from "../../shared/apps-ipc";
import {
  AGENT_CHANNEL,
  type AgentBridgeApi,
  type AgentSendPayload,
} from "../../shared/agent-ipc";
import {
  CHATS_CHANNEL,
  type ChatsBridgeApi,
  type ChatsEvent,
} from "../../shared/chats-ipc";
import {
  BASES_CHANNEL,
  type BasesBridgeApi,
  type BasesEvent,
} from "../../shared/bases-ipc";
import {
  GALLERY_MEDIA_CHANNEL,
  type GalleryItemProjectionEventV1,
  type GalleryMediaBridgeApi,
} from "../../shared/gallery-media-ipc";
import {
  PROJECTS_CHANNEL,
  type ProjectsBridgeApi,
  type ProjectsEvent,
} from "../../shared/projects-ipc";
import {
  INITIAL_DARK_ARGUMENT,
  INITIAL_LANGUAGE_ARGUMENT,
  SETTINGS_CHANNEL,
  type SettingsBridgeApi,
  type SettingsEnvelope,
} from "../../shared/settings-ipc";
import { DEFAULT_APP_LOCALE, isAppLocale } from "../../shared/i18n/locale";
import {
  SETUP_CHANNEL,
  type SetupBridgeApi,
} from "../../shared/setup-ipc";
import {
  SKILLS_CHANNEL,
  type SkillsBridgeApi,
} from "../../shared/skills-ipc";
import {
  UNIFIED_SKILLS_CHANNEL,
  type UnifiedSkillsBridgeApi,
  type UnifiedSkillsSnapshot,
} from "../../shared/unified-skills-ipc";
import {
  WORKSPACE_FILES_CHANNEL,
  type WorkspaceFilesBridgeApi,
} from "../../shared/workspace-files-ipc";
import {
  SECTIONS_CHANNEL,
  type SectionsBridgeApi,
} from "../../shared/sections-ipc";
import {
  USAGE_CHANNEL,
  type UsageBridgeApi,
  type UsagePricingUpdate,
  type UsageScanProgress,
} from "../../shared/usage-ipc";
import {
  MEMORY_CHANNEL,
  type MemoryBridgeApi,
  type MemoryRuntimeSnapshot,
  type MemoryStatusSnapshot,
} from "../../shared/memory-ipc";
import {
  EXTENSIONS_CHANNEL,
  type ExtensionsBridgeApi,
  type ExtensionsChangedEvent,
} from "../../shared/extensions-ipc";
import {
  ARCHIVE_CHANNEL,
  type ArchiveBridgeApi,
  type ArchiveEvent,
} from "../../shared/archive-ipc";
import {
  BROWSER_CHANNEL,
  type BrowserBridgeApi,
} from "../../shared/browser-ipc";
import {
  BROWSER_IMPORT_CHANNEL,
  type BrowserImportBridgeApi,
} from "../../shared/browser-import-ipc";
import {
  MCP_SERVERS_CHANNEL,
  type McpServersBridgeApi,
  type McpServersChangedEvent,
} from "../../shared/mcp-servers-ipc";
import {
  PROJECT_TOOLS_CHANNEL,
  type ProjectToolsBridgeApi,
  type ProjectToolsChangedEvent,
} from "../../shared/project-tools-ipc";
import {
  HISTORY_IMPORT_CHANNEL,
  type HistoryImportBridgeApi,
  type HistoryImportEvent,
} from "../../shared/history-import-ipc";
import {
  SEARCH_JOB_CHANNEL,
  type SearchJobBridgeApi,
} from "../../shared/search-ipc";
import {
  PERSONALIZATION_CHANNEL,
  PROJECT_PERSONALIZATION_CHANNEL,
  type PersonalizationBridgeApi,
  type ProjectPersonalizationBridgeApi,
} from "../../shared/personalization-ipc";
import {
  UPDATE_CHANNEL,
  type UpdateBridgeApi,
} from "../../shared/update-ipc";
import {
  WINDOW_APP_ID_ARGUMENT,
  WINDOW_ID_ARGUMENT,
  WINDOW_ROLE_ARGUMENT,
  WINDOW_SURFACES_CHANNEL,
  type ProductWindowRole,
  type SurfaceMigrationCommand,
  type WindowSurfacesBridgeApi,
} from "../../shared/window-surfaces-ipc";
import { initializePreloadFrame } from "../main/window/rtc-lockdown";

const exposeProductBridge = initializePreloadFrame(
  (script) => contextBridge.executeInMainWorld(script),
  process.isMainFrame,
  (error) => {
    console.error("[security] WebRTC main-world lockdown failed", error);
    process.crash();
    throw error;
  }
);

if (exposeProductBridge) {

// ─── 事件订阅统一剥离 IpcRendererEvent，只透传业务值 ───
const subscribe =
  <T>(channel: string) =>
  (callback: (event: T) => void) => {
    const wrapped = (_event: IpcRendererEvent, value: T) => callback(value);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  };

const initialLanguageValue = process.argv
  .find((argument) => argument.startsWith(INITIAL_LANGUAGE_ARGUMENT))
  ?.slice(INITIAL_LANGUAGE_ARGUMENT.length);
const initialLanguage = isAppLocale(initialLanguageValue)
  ? initialLanguageValue
  : DEFAULT_APP_LOCALE;

const startupArgument = (prefix: string) =>
  process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
const roleValue = startupArgument(WINDOW_ROLE_ARGUMENT);
const windowRole: ProductWindowRole =
  roleValue === "app-window" ? "app-window" : "main";
const windowContext = Object.freeze({
  windowId: startupArgument(WINDOW_ID_ARGUMENT) || "main",
  role: windowRole,
  appId:
    windowRole === "app-window"
      ? startupArgument(WINDOW_APP_ID_ARGUMENT) || null
      : null,
});

contextBridge.exposeInMainWorld("windowSurfaces", {
  context: windowContext,
  residence: (surface) =>
    ipcRenderer.invoke(WINDOW_SURFACES_CHANNEL.residence, surface),
  showSurface: (input) =>
    ipcRenderer.invoke(WINDOW_SURFACES_CHANNEL.show, input),
  openInWindow: (input) =>
    ipcRenderer.invoke(WINDOW_SURFACES_CHANNEL.openInWindow, input),
  reclaim: (input) =>
    ipcRenderer.invoke(WINDOW_SURFACES_CHANNEL.reclaim, input),
  syncUseChat: (input) =>
    ipcRenderer.invoke(WINDOW_SURFACES_CHANNEL.syncUseChat, input),
  reply: (input) =>
    ipcRenderer.send(WINDOW_SURFACES_CHANNEL.migrationReply, input),
  onCommand: subscribe<SurfaceMigrationCommand>(WINDOW_SURFACES_CHANNEL.command),
} satisfies WindowSurfacesBridgeApi);

contextBridge.exposeInMainWorld("browser", {
  createTab: (input = {}) =>
    ipcRenderer.invoke(BROWSER_CHANNEL.createTab, input),
  closeTab: (input) => ipcRenderer.invoke(BROWSER_CHANNEL.closeTab, input),
  activateTab: (input) =>
    ipcRenderer.invoke(BROWSER_CHANNEL.activateTab, input),
  navigate: (input) => ipcRenderer.invoke(BROWSER_CHANNEL.navigate, input),
  goBack: (input) => ipcRenderer.invoke(BROWSER_CHANNEL.goBack, input),
  goForward: (input) => ipcRenderer.invoke(BROWSER_CHANNEL.goForward, input),
  reload: (input) => ipcRenderer.invoke(BROWSER_CHANNEL.reload, input),
  setViewport: (input) =>
    ipcRenderer.invoke(BROWSER_CHANNEL.setViewport, input),
  setVisible: (input) =>
    ipcRenderer.invoke(BROWSER_CHANNEL.setVisible, input),
  stopAgentBatch: (input) =>
    ipcRenderer.invoke(BROWSER_CHANNEL.stopAgentBatch, input),
  onTabsChanged: subscribe(BROWSER_CHANNEL.tabsChanged),
} satisfies BrowserBridgeApi);

contextBridge.exposeInMainWorld("browserImport", {
  availability: () => ipcRenderer.invoke(BROWSER_IMPORT_CHANNEL.availability),
  detectProfiles: () =>
    ipcRenderer.invoke(BROWSER_IMPORT_CHANNEL.detectProfiles),
  previewCookieDomains: (input) =>
    ipcRenderer.invoke(BROWSER_IMPORT_CHANNEL.previewCookieDomains, input),
  importCookies: (input) =>
    ipcRenderer.invoke(BROWSER_IMPORT_CHANNEL.importCookies, input),
} satisfies BrowserImportBridgeApi);

contextBridge.exposeInMainWorld("personalization", {
  list: () => ipcRenderer.invoke(PERSONALIZATION_CHANNEL.list),
  save: (input) => ipcRenderer.invoke(PERSONALIZATION_CHANNEL.save, input),
  reveal: (backend) => ipcRenderer.invoke(PERSONALIZATION_CHANNEL.reveal, backend),
} satisfies PersonalizationBridgeApi);

contextBridge.exposeInMainWorld("projectPersonalization", {
  list: (projectId) =>
    ipcRenderer.invoke(PROJECT_PERSONALIZATION_CHANNEL.list, projectId),
  save: (input) =>
    ipcRenderer.invoke(PROJECT_PERSONALIZATION_CHANNEL.save, input),
  reveal: (projectId, fileId) =>
    ipcRenderer.invoke(
      PROJECT_PERSONALIZATION_CHANNEL.reveal,
      projectId,
      fileId
    ),
} satisfies ProjectPersonalizationBridgeApi);

contextBridge.exposeInMainWorld("agent", {
  send: (payload: AgentSendPayload) =>
    ipcRenderer.invoke(AGENT_CHANNEL.send, payload),
  cancel: (requestId: string) =>
    ipcRenderer.send(AGENT_CHANNEL.cancel, requestId),
  respondApproval: (response) =>
    ipcRenderer.invoke(AGENT_CHANNEL.respondApproval, response),
  respondUserInput: (response) =>
    ipcRenderer.invoke(AGENT_CHANNEL.respondUserInput, response),
  attachTurn: (conversationId, attachmentId) =>
    ipcRenderer.invoke(AGENT_CHANNEL.turnAttach, conversationId, attachmentId),
  detachTurn: (conversationId, attachmentId) =>
    ipcRenderer.send(AGENT_CHANNEL.turnDetach, conversationId, attachmentId),
  abandonFatalTurn: (conversationId) =>
    ipcRenderer.invoke(AGENT_CHANNEL.abandonFatalTurn, conversationId),
  acknowledgeCleanupFailure: (conversationId) =>
    ipcRenderer.invoke(AGENT_CHANNEL.acknowledgeCleanupFailure, conversationId),
  retryWithoutSession: (requestId, retryToken) =>
    ipcRenderer.invoke(AGENT_CHANNEL.retryWithoutSession, requestId, retryToken),
  retrySameSession: (requestId, retryToken) =>
    ipcRenderer.invoke(AGENT_CHANNEL.retrySameSession, requestId, retryToken),
  onEvent: subscribe(AGENT_CHANNEL.event),
  onActivity: subscribe(AGENT_CHANNEL.activity),
  listActivity: () => ipcRenderer.invoke(AGENT_CHANNEL.activityList),
  steer: (input) => ipcRenderer.invoke(AGENT_CHANNEL.steer, input),
  decideSteer: (input) =>
    ipcRenderer.invoke(AGENT_CHANNEL.decideSteer, input),
  ackSteerIntents: (outboxRefs) =>
    ipcRenderer.invoke(AGENT_CHANNEL.ackSteerIntents, outboxRefs),
} satisfies AgentBridgeApi);

contextBridge.exposeInMainWorld("app", {
  openExternal: (url: string) =>
    ipcRenderer.invoke(APP_CHANNEL.openExternal, url),
  writeClipboard: (text: string) =>
    ipcRenderer.invoke(APP_CHANNEL.writeClipboard, text),
  authorizeFile: (file, scope) => {
    const path = webUtils.getPathForFile(file);
    return ipcRenderer.invoke(APP_CHANNEL.authorizeFile, {
      path,
      name: file.name,
      mediaType: file.type,
      scope,
    });
  },
  releaseFile: (fileRef) =>
    ipcRenderer.invoke(APP_CHANNEL.releaseFile, fileRef),
} satisfies AppBridgeApi);

contextBridge.exposeInMainWorld("update", {
  snapshot: () => ipcRenderer.invoke(UPDATE_CHANNEL.snapshot),
  check: () => ipcRenderer.invoke(UPDATE_CHANNEL.check),
  downloadAndInstall: () =>
    ipcRenderer.invoke(UPDATE_CHANNEL.downloadAndInstall),
  appInfo: () => ipcRenderer.invoke(UPDATE_CHANNEL.appInfo),
  onChanged: subscribe(UPDATE_CHANNEL.subscribe),
} satisfies UpdateBridgeApi);

contextBridge.exposeInMainWorld("skills", {
  list: (input) => ipcRenderer.invoke(SKILLS_CHANNEL.list, input),
  capabilities: (scope) =>
    ipcRenderer.invoke(SKILLS_CHANNEL.capabilities, scope),
  onChanged: subscribe(SKILLS_CHANNEL.changed),
} satisfies SkillsBridgeApi);

contextBridge.exposeInMainWorld("unifiedSkills", {
  list: (forceReload) => ipcRenderer.invoke(UNIFIED_SKILLS_CHANNEL.list, forceReload),
  candidates: (agent, forceReload) => ipcRenderer.invoke(UNIFIED_SKILLS_CHANNEL.candidates, agent, forceReload),
  chooseLocal: () => ipcRenderer.invoke(UNIFIED_SKILLS_CHANNEL.chooseLocal),
  previewIntents: (intents) => ipcRenderer.invoke(UNIFIED_SKILLS_CHANNEL.previewIntents, intents),
  applyPlan: (input) => ipcRenderer.invoke(UNIFIED_SKILLS_CHANNEL.applyPlan, input),
  undoPlan: (undoToken) => ipcRenderer.invoke(UNIFIED_SKILLS_CHANNEL.undoPlan, undoToken),
  onChanged: subscribe<UnifiedSkillsSnapshot>(UNIFIED_SKILLS_CHANNEL.changed),
  onProgress: subscribe(UNIFIED_SKILLS_CHANNEL.progress),
} satisfies UnifiedSkillsBridgeApi);

contextBridge.exposeInMainWorld("workspaceFiles", {
  search: (input) =>
    ipcRenderer.invoke(WORKSPACE_FILES_CHANNEL.search, input),
  resign: (input) =>
    ipcRenderer.invoke(WORKSPACE_FILES_CHANNEL.resign, input),
  read: (input) =>
    ipcRenderer.invoke(WORKSPACE_FILES_CHANNEL.read, input),
} satisfies WorkspaceFilesBridgeApi);

contextBridge.exposeInMainWorld("sections", {
  submitManualTurn: (input) =>
    ipcRenderer.invoke(SECTIONS_CHANNEL.submitManualTurn, input),
  cancelManualTurn: (requestId) =>
    ipcRenderer.invoke(SECTIONS_CHANNEL.cancelManualTurn, requestId),
  ackManualIntents: (intentIds) =>
    ipcRenderer.invoke(SECTIONS_CHANNEL.ackManualIntents, intentIds),
  ackSubmission: (input) =>
    ipcRenderer.invoke(SECTIONS_CHANNEL.ackSubmission, input),
  submissionOutcome: (intentId) =>
    ipcRenderer.invoke(SECTIONS_CHANNEL.submissionOutcome, intentId),
  onSubmissionOutcome: subscribe(SECTIONS_CHANNEL.submissionOutcomeEvent),
  stopRelayChain: (requestId) =>
    ipcRenderer.invoke(SECTIONS_CHANNEL.stopRelayChain, requestId),
  continueRelay: (input) =>
    ipcRenderer.invoke(SECTIONS_CHANNEL.continueRelay, input),
  discardRelay: (input) =>
    ipcRenderer.invoke(SECTIONS_CHANNEL.discardRelay, input),
  actionsSnapshot: () =>
    ipcRenderer.invoke(SECTIONS_CHANNEL.actionsSnapshot),
  onActionsEvent: subscribe(SECTIONS_CHANNEL.actionsEvent),
} satisfies SectionsBridgeApi);

contextBridge.exposeInMainWorld("apps", {
  add: (input: AddAppInput) => ipcRenderer.invoke(APPS_CHANNEL.add, input),
  remove: (appId, mode, requestId) =>
    ipcRenderer.invoke(APPS_CHANNEL.remove, appId, mode, requestId),
  list: () => ipcRenderer.invoke(APPS_CHANNEL.list),
  open: (appId: string) => ipcRenderer.invoke(APPS_CHANNEL.open, appId),
  status: (appId: string) => ipcRenderer.invoke(APPS_CHANNEL.status, appId),
  originWithoutStart: (appId: string) =>
    ipcRenderer.invoke(APPS_CHANNEL.originWithoutStart, appId),
  stop: (appId: string) => ipcRenderer.invoke(APPS_CHANNEL.stop, appId),
  grant: (input) => ipcRenderer.invoke(APPS_CHANNEL.grant, input),
  revokeGrant: (target, appId) =>
    ipcRenderer.invoke(APPS_CHANNEL.revokeGrant, target, appId),
  setGrantState: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.setGrantState, input),
  setDefaultGrant: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.setDefaultGrant, input),
  listGrantSources: () => ipcRenderer.invoke(APPS_CHANNEL.listGrantSources),
  listAvailable: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.listAvailable, input),
  acquireSurface: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.acquireSurface, input),
  releaseSurface: (surfaceLeaseId) =>
    ipcRenderer.invoke(APPS_CHANNEL.releaseSurface, surfaceLeaseId),
  acquireManagementLease: (appId) =>
    ipcRenderer.invoke(APPS_CHANNEL.acquireManagementLease, appId),
  releaseManagementLease: (managementLeaseId) =>
    ipcRenderer.invoke(APPS_CHANNEL.releaseManagementLease, managementLeaseId),
  reveal: (appId: string) => ipcRenderer.invoke(APPS_CHANNEL.reveal, appId),
  cancelInstall: (appId: string) =>
    ipcRenderer.invoke(APPS_CHANNEL.cancelInstall, appId),
  readLog: (appId: string) => ipcRenderer.invoke(APPS_CHANNEL.readLog, appId),
  retry: (appId: string) => ipcRenderer.invoke(APPS_CHANNEL.retry, appId),
  repair: (appId: string) => ipcRenderer.invoke(APPS_CHANNEL.repair, appId),
  setAgent: (input) => ipcRenderer.invoke(APPS_CHANNEL.setAgent, input),
  saveAsApp: (input) => ipcRenderer.invoke(APPS_CHANNEL.saveAsApp, input),
  rename: (input) => ipcRenderer.invoke(APPS_CHANNEL.rename, input),
  ensureChatSlot: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.ensureChatSlot, input),
  retrySkill: (appId) =>
    ipcRenderer.invoke(APPS_CHANNEL.retrySkill, appId),
  resolveExtensionConsent: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.resolveExtensionConsent, input),
  resolveBaseGuiConsent: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.resolveBaseGuiConsent, input),
  revokeBaseGuiAccess: (appId) =>
    ipcRenderer.invoke(APPS_CHANNEL.revokeBaseGuiAccess, appId),
  promoteGeneration: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.promoteGeneration, input),
  extensionStatus: (appId) =>
    ipcRenderer.invoke(APPS_CHANNEL.extensionStatus, appId),
  revokeExtensionGrant: (appId) =>
    ipcRenderer.invoke(APPS_CHANNEL.revokeExtensionGrant, appId),
  rebuildExtensionGeneration: (appId) =>
    ipcRenderer.invoke(APPS_CHANNEL.rebuildExtensionGeneration, appId),
  capabilities: (appId) =>
    ipcRenderer.invoke(APPS_CHANNEL.capabilities, appId),
  guiInfo: (input) => ipcRenderer.invoke(APPS_CHANNEL.guiInfo, input),
  releaseGuiSurface: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.releaseGuiSurface, input),
  setOpenMode: (input) => ipcRenderer.invoke(APPS_CHANNEL.setOpenMode, input),
  importDesignCanvas: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.importDesignCanvas, input),
  listDesignImportCandidates: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.listDesignImportCandidates, input),
  listDesignFiles: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.listDesignFiles, input),
  listDesignVersions: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.listDesignVersions, input),
  restoreDesignVersion: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.restoreDesignVersion, input),
  setDesignAutoOpen: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.setDesignAutoOpen, input),
  designDataStatus: (appId) =>
    ipcRenderer.invoke(APPS_CHANNEL.designDataStatus, appId),
  deleteDesignData: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.deleteDesignData, input),
  setDesignEnabled: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.setDesignEnabled, input),
  readReadme: (appId) =>
    ipcRenderer.invoke(APPS_CHANNEL.readReadme, appId),
  probeRepo: (repoUrl) =>
    ipcRenderer.invoke(APPS_CHANNEL.probeRepo, repoUrl),
  discardProbe: (preflightId) =>
    ipcRenderer.invoke(APPS_CHANNEL.discardProbe, preflightId),
  listPresets: () => ipcRenderer.invoke(APPS_CHANNEL.listPresets),
  probePreset: (presetId) =>
    ipcRenderer.invoke(APPS_CHANNEL.probePreset, presetId),
  discardPresetProbe: (preflightId) =>
    ipcRenderer.invoke(APPS_CHANNEL.discardPresetProbe, preflightId),
  installPreset: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.installPreset, input),
  ghStatus: () => ipcRenderer.invoke(APPS_CHANNEL.ghStatus),
  readConfig: (appId) =>
    ipcRenderer.invoke(APPS_CHANNEL.readConfig, appId),
  writeConfig: (appId, config) =>
    ipcRenderer.invoke(APPS_CHANNEL.writeConfig, appId, config),
  sharePreview: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.sharePreview, input),
  sharePublish: (input) =>
    ipcRenderer.invoke(APPS_CHANNEL.sharePublish, input),
  shareDiscard: (previewId) =>
    ipcRenderer.invoke(APPS_CHANNEL.shareDiscard, previewId),
  onEvent: subscribe(APPS_CHANNEL.event),
} satisfies AppsBridgeApi);

contextBridge.exposeInMainWorld("chats", {
  list: () => ipcRenderer.invoke(CHATS_CHANNEL.list),
  get: (chatId: string) => ipcRenderer.invoke(CHATS_CHANNEL.get, chatId),
  messagesSnapshot: (chatId: string) =>
    ipcRenderer.invoke(CHATS_CHANNEL.messagesSnapshot, chatId),
  create: (input) => ipcRenderer.invoke(CHATS_CHANNEL.create, input),
  createForApp: (input) =>
    ipcRenderer.invoke(CHATS_CHANNEL.createForApp, input),
  append: (input) => ipcRenderer.invoke(CHATS_CHANNEL.append, input),
  rename: (input) => ipcRenderer.invoke(CHATS_CHANNEL.rename, input),
  remove: (chatId: string) => ipcRenderer.invoke(CHATS_CHANNEL.remove, chatId),
  readAttachment: (attachmentId: string) =>
    ipcRenderer.invoke(CHATS_CHANNEL.readAttachment, attachmentId),
  onEvent: subscribe<ChatsEvent>(CHATS_CHANNEL.event),
} satisfies ChatsBridgeApi);

contextBridge.exposeInMainWorld("galleryMedia", {
  thumbnail: (input) =>
    ipcRenderer.invoke(GALLERY_MEDIA_CHANNEL.thumbnail, input),
  materialize: (input) =>
    ipcRenderer.invoke(GALLERY_MEDIA_CHANNEL.materialize, input),
  onGalleryMediaEvent: subscribe<GalleryItemProjectionEventV1>(
    GALLERY_MEDIA_CHANNEL.event
  ),
} satisfies GalleryMediaBridgeApi);

contextBridge.exposeInMainWorld("bases", {
  get: (input) => ipcRenderer.invoke(BASES_CHANNEL.get, input),
  ensure: (input) => ipcRenderer.invoke(BASES_CHANNEL.ensure, input),
  discardCorrupt: (input) =>
    ipcRenderer.invoke(BASES_CHANNEL.discardCorrupt, input),
  listPinned: () => ipcRenderer.invoke(BASES_CHANNEL.listPinned),
  listProjectBases: () => ipcRenderer.invoke(BASES_CHANNEL.listProject),
  authorizeMutation: (input) =>
    ipcRenderer.invoke(BASES_CHANNEL.authorizeMutation, input),
  updateMeta: (input) => ipcRenderer.invoke(BASES_CHANNEL.updateMeta, input),
  insertRows: (input) => ipcRenderer.invoke(BASES_CHANNEL.insertRows, input),
  patchRow: (input) => ipcRenderer.invoke(BASES_CHANNEL.patchRow, input),
  deleteRows: (input) => ipcRenderer.invoke(BASES_CHANNEL.deleteRows, input),
  exportCsv: (input) => ipcRenderer.invoke(BASES_CHANNEL.exportCsv, input),
  exportJson: (input) => ipcRenderer.invoke(BASES_CHANNEL.exportJson, input),
  importJson: (input) => ipcRenderer.invoke(BASES_CHANNEL.importJson, input),
  exportXlsx: (input) => ipcRenderer.invoke(BASES_CHANNEL.exportXlsx, input),
  importXlsx: (input) => ipcRenderer.invoke(BASES_CHANNEL.importXlsx, input),
  rowHistory: (input) => ipcRenderer.invoke(BASES_CHANNEL.rowHistory, input),
  putAttachment: (input) =>
    ipcRenderer.invoke(BASES_CHANNEL.putAttachment, input),
  readAttachment: (input) =>
    ipcRenderer.invoke(BASES_CHANNEL.readAttachment, input),
  readAttachmentThumbnail: (input) =>
    ipcRenderer.invoke(BASES_CHANNEL.readAttachmentThumbnail, input),
  listGalleryEntries: (input) =>
    ipcRenderer.invoke(BASES_CHANNEL.listGalleryEntries, input),
  resolveForSection: (input) =>
    ipcRenderer.invoke(BASES_CHANNEL.resolveForSection, input),
  promoteToProject: (input) =>
    ipcRenderer.invoke(BASES_CHANNEL.promoteToProject, input),
  onBasesEvent: subscribe<BasesEvent>(BASES_CHANNEL.event),
} satisfies BasesBridgeApi);

contextBridge.exposeInMainWorld("projects", {
  list: () => ipcRenderer.invoke(PROJECTS_CHANNEL.list),
  ensureForApp: (appId: string) =>
    ipcRenderer.invoke(PROJECTS_CHANNEL.ensureForApp, appId),
  rename: (projectId: string, name: string) =>
    ipcRenderer.invoke(PROJECTS_CHANNEL.rename, projectId, name),
  setAppearance: (projectId, appearance) =>
    ipcRenderer.invoke(PROJECTS_CHANNEL.setAppearance, projectId, appearance),
  detachLocal: (projectId: string) =>
    ipcRenderer.invoke(PROJECTS_CHANNEL.detachLocal, projectId),
  releaseMissing: (projectId: string) =>
    ipcRenderer.invoke(PROJECTS_CHANNEL.releaseMissing, projectId),
  setSortMode: (sortMode) =>
    ipcRenderer.invoke(PROJECTS_CHANNEL.setSortMode, sortMode),
  listBranches: (projectId: string) =>
    ipcRenderer.invoke(PROJECTS_CHANNEL.listBranches, projectId),
  checkoutBranch: (projectId, target) =>
    ipcRenderer.invoke(PROJECTS_CHANNEL.checkoutBranch, projectId, target),
  createBranch: (projectId, name) =>
    ipcRenderer.invoke(PROJECTS_CHANNEL.createBranch, projectId, name),
  chooseWorkspaceBinding: (projectId, mode) =>
    ipcRenderer.invoke(
      PROJECTS_CHANNEL.chooseWorkspaceBinding,
      projectId,
      mode
    ),
  onEvent: subscribe<ProjectsEvent>(PROJECTS_CHANNEL.event),
} satisfies ProjectsBridgeApi);

contextBridge.exposeInMainWorld("historyImport", {
  snapshot: () => ipcRenderer.invoke(HISTORY_IMPORT_CHANNEL.snapshot),
  prepareProject: () => ipcRenderer.invoke(HISTORY_IMPORT_CHANNEL.prepareProject),
  countProject: (token) => ipcRenderer.invoke(HISTORY_IMPORT_CHANNEL.countProject, token),
  commitProject: (input) => ipcRenderer.invoke(HISTORY_IMPORT_CHANNEL.commitProject, input),
  setProjectEnabled: (projectId, enabled) =>
    ipcRenderer.invoke(HISTORY_IMPORT_CHANNEL.setProjectEnabled, projectId, enabled),
  refreshProject: (projectId) =>
    ipcRenderer.invoke(HISTORY_IMPORT_CHANNEL.refreshProject, projectId),
  renameSession: (opaqueId, title) =>
    ipcRenderer.invoke(HISTORY_IMPORT_CHANNEL.renameSession, opaqueId, title),
  setSessionArchived: (opaqueId, archived) =>
    ipcRenderer.invoke(HISTORY_IMPORT_CHANNEL.setSessionArchived, opaqueId, archived),
  transcript: (input) =>
    ipcRenderer.invoke(HISTORY_IMPORT_CHANNEL.transcript, input),
  transcriptIndex: (input) =>
    ipcRenderer.invoke(HISTORY_IMPORT_CHANNEL.transcriptIndex, input),
  cancelTranscript: (requestId) =>
    ipcRenderer.send(HISTORY_IMPORT_CHANNEL.cancelTranscript, requestId),
  adopt: (input) => ipcRenderer.invoke(HISTORY_IMPORT_CHANNEL.adopt, input),
  adoptionPrefix: (chatId) => ipcRenderer.invoke(HISTORY_IMPORT_CHANNEL.adoptionPrefix, chatId),
  memoryEligibility: (input) =>
    ipcRenderer.invoke(HISTORY_IMPORT_CHANNEL.memoryEligibility, input),
  memoryPreview: (input) =>
    ipcRenderer.invoke(HISTORY_IMPORT_CHANNEL.memoryPreview, input),
  memoryCommit: (snapshotId, digest) =>
    ipcRenderer.invoke(HISTORY_IMPORT_CHANNEL.memoryCommit, snapshotId, digest),
  onEvent: subscribe<HistoryImportEvent>(HISTORY_IMPORT_CHANNEL.event),
} satisfies HistoryImportBridgeApi);

contextBridge.exposeInMainWorld("globalSearch", {
  start: (input) => ipcRenderer.invoke(SEARCH_JOB_CHANNEL.start, input),
  pull: (input) => ipcRenderer.invoke(SEARCH_JOB_CHANNEL.pull, input),
  cancel: (jobId) => ipcRenderer.invoke(SEARCH_JOB_CHANNEL.cancel, jobId),
} satisfies SearchJobBridgeApi);

contextBridge.exposeInMainWorld("settings", {
  /* 首帧主题只能同步到达，异步 IPC 一律晚于第一次绘制；建窗参数是
     唯一「main 已知、renderer 未跑一行代码就能读」的通道。 */
  initialDark: process.argv.some(
    (argument) => argument === `${INITIAL_DARK_ARGUMENT}true`
  ),
  initialLanguage,
  onThemeResolved: subscribe<boolean>(SETTINGS_CHANNEL.themeResolved),
  get: () => ipcRenderer.invoke(SETTINGS_CHANNEL.get),
  set: (patch) => ipcRenderer.invoke(SETTINGS_CHANNEL.set, patch),
  mutateMemory: (mutation) =>
    ipcRenderer.invoke(SETTINGS_CHANNEL.mutateMemory, mutation),
  onChanged: subscribe<SettingsEnvelope>(SETTINGS_CHANNEL.changed),
  getChatHomeStatus: () =>
    ipcRenderer.invoke(SETTINGS_CHANNEL.getChatHomeStatus),
  chooseChatHomesRoot: () =>
    ipcRenderer.invoke(SETTINGS_CHANNEL.chooseChatHomesRoot),
  acknowledgeFullAccess: () =>
    ipcRenderer.invoke(SETTINGS_CHANNEL.acknowledgeFullAccess),
  listBackends: () => ipcRenderer.invoke(SETTINGS_CHANNEL.listBackends),
  listModels: (backend, scope) =>
    ipcRenderer.invoke(SETTINGS_CHANNEL.listModels, backend, scope),
  resolveChatOptions: (scope, backend) =>
    ipcRenderer.invoke(SETTINGS_CHANNEL.resolveChatOptions, scope, backend),
  setChatOptions: (scope, options, resetSessionEffective) =>
    ipcRenderer.invoke(
      SETTINGS_CHANNEL.setChatOptions,
      scope,
      options,
      resetSessionEffective
    ),
} satisfies SettingsBridgeApi);

contextBridge.exposeInMainWorld("projectTools", {
  get: (input) => ipcRenderer.invoke(PROJECT_TOOLS_CHANNEL.get, input),
  setBuiltinOverride: (input) =>
    ipcRenderer.invoke(PROJECT_TOOLS_CHANNEL.setBuiltinOverride, input),
  resetBuiltinOverride: (input) =>
    ipcRenderer.invoke(PROJECT_TOOLS_CHANNEL.resetBuiltinOverride, input),
  setGlobalMcpOverride: (input) =>
    ipcRenderer.invoke(PROJECT_TOOLS_CHANNEL.setGlobalMcpOverride, input),
  resetGlobalMcpOverride: (input) =>
    ipcRenderer.invoke(PROJECT_TOOLS_CHANNEL.resetGlobalMcpOverride, input),
  resetAll: (input) =>
    ipcRenderer.invoke(PROJECT_TOOLS_CHANNEL.resetAll, input),
  onChanged: subscribe<ProjectToolsChangedEvent>(PROJECT_TOOLS_CHANNEL.changed),
} satisfies ProjectToolsBridgeApi);

contextBridge.exposeInMainWorld("mcpServers", {
  list: (input) => ipcRenderer.invoke(MCP_SERVERS_CHANNEL.list, input),
  save: (input) => ipcRenderer.invoke(MCP_SERVERS_CHANNEL.save, input),
  remove: (input) => ipcRenderer.invoke(MCP_SERVERS_CHANNEL.remove, input),
  onChanged: subscribe<McpServersChangedEvent>(MCP_SERVERS_CHANNEL.changed),
} satisfies McpServersBridgeApi);

contextBridge.exposeInMainWorld("archive", {
  list: () => ipcRenderer.invoke(ARCHIVE_CHANNEL.list),
  archive: (targets) => ipcRenderer.invoke(ARCHIVE_CHANNEL.archive, targets),
  restore: (targets) => ipcRenderer.invoke(ARCHIVE_CHANNEL.restore, targets),
  previewPurge: (targets) =>
    ipcRenderer.invoke(ARCHIVE_CHANNEL.previewPurge, targets),
  executePurge: (executionToken, targets, mode) =>
    ipcRenderer.invoke(
      ARCHIVE_CHANNEL.executePurge,
      executionToken,
      targets,
      mode
    ),
  onEvent: subscribe<ArchiveEvent>(ARCHIVE_CHANNEL.event),
} satisfies ArchiveBridgeApi);

contextBridge.exposeInMainWorld("setup", {
  check: () => ipcRenderer.invoke(SETUP_CHANNEL.check),
  recheck: (backend) => ipcRenderer.invoke(SETUP_CHANNEL.recheck, backend),
  refreshLatest: (backend) =>
    ipcRenderer.invoke(SETUP_CHANNEL.refreshLatest, backend),
  terminalAction: (backend, action) =>
    ipcRenderer.invoke(SETUP_CHANNEL.terminalAction, { backend, action }),
  onEvent: subscribe(SETUP_CHANNEL.event),
} satisfies SetupBridgeApi);

contextBridge.exposeInMainWorld("usage", {
  getSummary: (target, options) =>
    ipcRenderer.invoke(USAGE_CHANNEL.getSummary, target, options),
  onScanProgress: (callback) => {
    const unsubscribe = subscribe<UsageScanProgress>(
      USAGE_CHANNEL.scanProgress
    )(callback);
    void ipcRenderer.invoke(USAGE_CHANNEL.replayProgress);
    return unsubscribe;
  },
  onPricingUpdated: subscribe<UsagePricingUpdate>(USAGE_CHANNEL.pricingUpdated),
} satisfies UsageBridgeApi);

contextBridge.exposeInMainWorld("extensions", {
  list: (input) => ipcRenderer.invoke(EXTENSIONS_CHANNEL.list, input),
  preflight: (input) => ipcRenderer.invoke(EXTENSIONS_CHANNEL.preflight, input),
  confirm: (input) => ipcRenderer.invoke(EXTENSIONS_CHANNEL.confirm, input),
  discard: (preflightId) =>
    ipcRenderer.invoke(EXTENSIONS_CHANNEL.discard, preflightId),
  beginDisable: (input) =>
    ipcRenderer.invoke(EXTENSIONS_CHANNEL.beginDisable, input),
  beginUninstall: (input) =>
    ipcRenderer.invoke(EXTENSIONS_CHANNEL.beginUninstall, input),
  resolveUninstall: (input) =>
    ipcRenderer.invoke(EXTENSIONS_CHANNEL.resolveUninstall, input),
  cancelUninstall: (input) =>
    ipcRenderer.invoke(EXTENSIONS_CHANNEL.cancelUninstall, input),
  purgeInstallData: (input) =>
    ipcRenderer.invoke(EXTENSIONS_CHANNEL.purgeInstallData, input),
  onChanged: subscribe<ExtensionsChangedEvent>(EXTENSIONS_CHANNEL.changed),
} satisfies ExtensionsBridgeApi);

contextBridge.exposeInMainWorld("memory", {
  providers: () => ipcRenderer.invoke(MEMORY_CHANNEL.providers),
  configPanels: () => ipcRenderer.invoke(MEMORY_CHANNEL.configPanels),
  getStatus: () => ipcRenderer.invoke(MEMORY_CHANNEL.getStatus),
  refreshHealth: () => ipcRenderer.invoke(MEMORY_CHANNEL.refreshHealth),
  supplyStreams: () => ipcRenderer.invoke(MEMORY_CHANNEL.supplyStreams),
  revealDataRoot: (providerId) =>
    ipcRenderer.invoke(MEMORY_CHANNEL.revealDataRoot, providerId),
  resolveAttention: (input) =>
    ipcRenderer.invoke(MEMORY_CHANNEL.resolveAttention, input),
  previewConsent: (input) =>
    ipcRenderer.invoke(MEMORY_CHANNEL.previewConsent, input),
  requestConsentAuthority: (input) =>
    ipcRenderer.invoke(MEMORY_CHANNEL.requestConsentAuthority, input),
  onStatus: subscribe<MemoryStatusSnapshot>(MEMORY_CHANNEL.status),
  getRuntimeState: (providerId) =>
    ipcRenderer.invoke(MEMORY_CHANNEL.runtimeGet, providerId),
  runRuntimeOperation: (input) =>
    ipcRenderer.invoke(MEMORY_CHANNEL.runtimeRun, input),
  writeRuntimeConfig: (input) =>
    ipcRenderer.invoke(MEMORY_CHANNEL.runtimeConfig, input),
  previewRuntimeConfig: (input) =>
    ipcRenderer.invoke(MEMORY_CHANNEL.runtimeConfigPreview, input),
  requestRuntimeConfigAuthority: (input) =>
    ipcRenderer.invoke(MEMORY_CHANNEL.runtimeConfigAuthority, input),
  refreshRuntimeState: (providerId) =>
    ipcRenderer.invoke(MEMORY_CHANNEL.runtimeRefresh, providerId),
  checkRuntimeUpdates: (input) =>
    ipcRenderer.invoke(MEMORY_CHANNEL.runtimeCheckUpdates, input),
  listRuntimeVersions: (providerId) =>
    ipcRenderer.invoke(MEMORY_CHANNEL.runtimeVersions, providerId),
  resolveRuntimeConfigIssue: (input) =>
    ipcRenderer.invoke(MEMORY_CHANNEL.resolveConfigIssue, input),
  onRuntimeState: subscribe<MemoryRuntimeSnapshot>(MEMORY_CHANNEL.runtimeState),
  requestDestructiveAuthority: (input) =>
    ipcRenderer.invoke(MEMORY_CHANNEL.requestDestructiveAuthority, input),
  consumeDestructiveAuthority: (token) =>
    ipcRenderer.invoke(MEMORY_CHANNEL.consumeDestructiveAuthority, token),
} satisfies MemoryBridgeApi);
}
