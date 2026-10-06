/**
 * [INPUT]: Provider identities/refusals, validated Chat preferences, backend/workspace/model types and fixed-purpose Settings capabilities.
 * [OUTPUT]: Provides settings v11 with the recorded Agent Install later mark, local archive-confetti and Lab Agent-connections preferences, the single-backend title Agent, main-owned presence writes, revision envelopes, Memory/Chat Home APIs including the onboarding folder suggestion (LibrarySuggestion), the dialog-free folder retry, folder move and whole-profile erase, and model/session options
 * [POS]: apps/desktop/shared/ipc/settings; defaultBackend may be a package Provider while it is available (TASK-11 S3-d); providerOrder is the full stored Provider order and the patch takes any well-formed Provider id for the two choices; id-taking bridge calls may answer a ProviderIpcRefusal (TASK-11 S3-c). Single source of truth for shared multi-process settings; main, preload, and renderer exchange only what this contract defines
 * Memory plugin availability and workflow reads default off; service authorization remains independent and owner-controlled.
 */

import type { ChatTurnOptions } from "../../chat-agent/options";
import type { ChatPreferenceWrite } from "../../chat-agent/preferences";
import type { ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";
import type { ProviderIpcRefusal } from "../../providers/catalog-ipc";
import type {
  AgentBackendId,
  AgentTurnOptions,
  AgentWorkspaceScope,
  BackendInfo,
  BackendModelInfo,
} from "../agent/agent-ipc";
import type { AppLocale, LanguagePreference } from "@ai-chat/ui/lib/locale";

export type DefaultChatOptionsByBackend = {
  [K in AgentBackendId]?: Extract<AgentTurnOptions, { backend: K }>;
};

/* 断代升级后 Chat Home 只有两态：没有迁移期，选定即就绪。 */
export type ChatHomeState = "unconfigured" | "ready";

/** Chat Home 未就绪的断言码：main 抛出，renderer 据此把用户送回设置。 */
export const CHAT_HOME_NOT_READY = "CHAT_HOME_NOT_READY";

export type ChatHomeStatus = {
  root: string | null;
  state: ChatHomeState;
  progress?: { phase: "opening" | "saving"; completed: number; total: number; failed: number } | null;
};

/* ============================================================
 * 主题偏好只有三个值，且与 Electron nativeTheme.themeSource 的
 * system|light|dark 一一对应——auto 不是产品要解析的第三种状态，
 * 是「不覆盖平台」，由 main 一次性折进 themeSource。
 *
 * 但 themeSource 实测不会改写 renderer 的 prefers-color-scheme
 * （main 侧 shouldUseDarkColors 已翻，renderer 的媒体查询纹丝不动），
 * 所以 renderer 不能自己感知，只能接收 main 解析好的布尔结果：
 * 初值随建窗参数同步到达（故无错色首帧），此后走 themeResolved 广播。
 * renderer 因此仍然没有 auto 分支——它根本不知道用户选了什么。
 * ============================================================ */
export const THEME_PREFERENCES = ["auto", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** 建窗参数前缀：main 用它把首帧的有效主题同步交给 preload。 */
export const INITIAL_DARK_ARGUMENT = "--ai-chat-initial-dark=";
/** 建窗参数前缀：preload 同步读取有效语言，第一帧不闪 fallback。 */
export const INITIAL_LANGUAGE_ARGUMENT = "--ai-chat-initial-language=";

/* ============================================================
 * 快捷键绑定：修饰键约定收进匹配器（meta-or-ctrl 必需、alt 硬拒），
 * 绑定本体只剩「哪个键、要不要 shift」两个自由度。key 存
 * event.key.toLowerCase() 的产物——布局相关，与录制时所见一致。
 * ============================================================ */
export type ShortcutBinding = {
  key: string;
  shift: boolean;
};

export type AppSettings = {
  /** Main-owned portable folder identity; never writable through generic settings IPC. */
  libraryRoot?: string | null;
  libraryId?: string | null;
  /** 只能经 Chat Home 专用 API 修改。 */
  chatHomesRoot: string | null;
  /** 只能经 Chat Home 专用 API 修改。 */
  chatHomeState: ChatHomeState;
  launchAtLogin: boolean;
  keepRunningInBackground: boolean;
  /** Remembered notch preference; effective only while background retention is enabled. */
  showTaskStatusAtTop: boolean;
  allowCrossChatRead: boolean;
  /** Publish this computer's Memory state (only its state, never content) to the account's phone and Web (TASK-28, R-33); off by default. */
  memoryPhoneFacade: boolean;
  memoryWorkflowRoles: boolean;
  /** 宽松持久化、消费时与当前 ambient 工具集求交；下一轮 turn 生效。 */
  disabledBuiltinTools: readonly string[];
  /** 只能经 acknowledgeFullAccess 写入。 */
  fullAccessAcknowledgedAt: number | null;
  /** auto 表示交还平台；main 据此设定 nativeTheme.themeSource。 */
  theme: ThemePreference;
  /** Local profile preference; system reduced motion still takes precedence. */
  archiveConfettiEnabled: boolean;
  /** auto 按系统首选语言解析，未命中受支持语言时回落英语。 */
  language: LanguagePreference;
  /** Exactly one backend generates Chat titles; there is no implicit fallback chain. */
  titleAgent: ProviderId;
  titleModelByBackend: Partial<Record<ProviderId, string | null>>;
  defaultChatOptionsByBackend: DefaultChatOptionsByBackend;
  /** Fallback when no last-used Chat Agent is remembered. A package Provider while it is available (TASK-11 S3-d),
      else the effective built-in; it never leaves this computer. */
  defaultBackend: ProviderId;
  /** Local explicit/use preference; New Chat checks the live catalog before using it. */
  lastChatBackend?: ProviderId | null;
  /** Distinguishes learned options from the former copied factory presets. */
  chatPreferenceVersion?: 1;
  /** The user's order of every Provider as stored (TASK-11 S3-c): a package or gone Provider keeps its place, and every runnable built-in is
      present. A picker reads the runnable ones; anything that leaves this computer narrows it to built-ins first. */
  providerOrder: ProviderId[];
  /** The Agent step was skipped with Install later: onboarding stops asking, and this computer can still operate others. */
  agentSetupDeferred?: boolean;
  /** The account already held this computer's name and the server suffixed it; Sync settings says so once. */
  computerNameHintSeen?: boolean;
  /** 每条跨 Section 链可自动触发的 turn 数；0 表示无限。 */
  autoRelayLimit: number;
  /** Usage 页是否允许按 24h TTL 从 models.dev 自动刷新价格。 */
  usagePricingAutoRefresh: boolean;
  /** One-time Skills discovery prompt; pending survives restarts until imported or skipped. */
  skillsOnboarding: "pending" | "done" | "skipped";
  /** 稀疏覆写：缺席=默认，null=停用。id 宽松持久化（同
      disabledBuiltinTools），消费时与 renderer 的默认表求交。 */
  keyboardShortcuts: Readonly<Record<string, ShortcutBinding | null>>;
  /** 只能经 Memory Settings Owner 的 discriminated mutation 修改。 */
  memory: MemorySettings;
};

/* ============================================================
 * Memory 是三个状态 owner 中唯一同时被磁盘与 runtime 持有的域：
 * pendingRevision/applyStatus 让「磁盘已新、runtime 还旧」的窗口
 * 始终可观测可收敛——apply 失败不再是一次性 toast。
 * ============================================================ */
export const MEMORY_SHARING_MODES = ["chat", "group", "personal"] as const;
export type MemorySharingMode = (typeof MEMORY_SHARING_MODES)[number];

export type MemorySettings = {
  /** Plugin availability is independent of the retained service and consent preferences. */
  pluginEnabled: boolean;
  /** 用户的长期启用意图；真正执行仍要求当前 instance 上存在有效 Consent。 */
  enabled: boolean;
  /** pause 是已启用域的可恢复撤销，不与「从未启用」混成一个布尔值。 */
  paused: boolean;
  provider: string;
  /** chat=本 Chat；group=Project/独立 Chat 池；personal=安装级全局池。 */
  sharingMode: MemorySharingMode;
  pendingRevision: number | null;
  applyStatus: {
    state: "pending" | "failed";
    message: string | null;
    at: number;
  } | null;
};

export type MemorySettingsMutation =
  | { kind: "enable-with-consent"; authorityToken: string }
  | {
      kind: "cutover-with-consent";
      providerId: string;
      authorityToken: string;
    }
  | {
      kind: "set-sharing-with-consent";
      sharingMode: MemorySharingMode;
      authorityToken: string;
    }
  | { kind: "set-paused"; paused: boolean };

/** memory 被整域摘除：renderer 只能经专用 mutation 出口写。 */
export type RendererSettingsPatch = Partial<
  Omit<
    AppSettings,
    | "chatHomesRoot"
    | "libraryRoot"
    | "libraryId"
    | "chatHomeState"
    | "fullAccessAcknowledgedAt"
    | "memory"
    | "memoryWorkflowRoles"
    | "launchAtLogin"
    | "keepRunningInBackground"
    | "showTaskStatusAtTop"
    | "titleAgent"
    | "defaultBackend"
  >
> & {
  /** Any well-formed Provider id: stored as chosen, read back as the one in effect while it cannot run here. */
  titleAgent?: ProviderId;
  defaultBackend?: ProviderId;
};

export type RendererSettingsMutation =
  | RendererSettingsPatch
  | ((current: AppSettings) => RendererSettingsPatch);

/** get / mutation 响应 / changed 广播共用同一信封：renderer 据 revision rebase。 */
export type SettingsEnvelope = {
  revision: number;
  settings: AppSettings;
};

export const SETTINGS_CHANNEL = {
  get: "settings:get",
  set: "settings:set",
  changed: "settings:changed",
  themeResolved: "settings:theme:resolved",
  mutateMemory: "settings:memory:mutate",
  getChatHomeStatus: "settings:chat-home:get-status",
  chatHomeChanged: "settings:chat-home:changed",
  chooseChatHomesRoot: "settings:chat-home:choose-root",
  suggestChatHomesRoot: "settings:chat-home:suggest-root",
  openSuggestedChatHomesRoot: "settings:chat-home:open-suggested-root",
  retryLibrary: "settings:library:retry",
  revealLibrary: "settings:library:reveal",
  planLibraryMove: "settings:library:plan-move",
  commitLibraryMove: "settings:library:commit-move",
  eraseAllData: "settings:erase-all",
  inspectEraseFolder: "settings:erase-all:inspect-folder",
  acknowledgeFullAccess: "settings:full-access:acknowledge",
  listBackends: "settings:list-backends",
  listModels: "settings:list-models",
  getBackendDefaults: "settings:backend-defaults",
  rememberChatDefaults: "settings:remember-chat-defaults",
  patchChatOptions: "settings:patch-chat-options",
} as const;

/** Onboarding's one-click folder: `name` is the folder's name inside the home folder. */
export type LibrarySuggestion = { path: string; name: string; kind: "fresh" | "occupied" | "found" };

/** `planId` is what a commit presents: the plan the person saw, once, from the window that asked. */
export type LibraryMovePlan = { from: string; to: string; planId: string };

export type SettingsBridgeApi = {
  /** 建窗那一刻的有效主题；同步可读，故首帧不会错色。 */
  initialDark: boolean;
  /** 建窗时已由 main 解析好的有效语言。 */
  initialLanguage: AppLocale;
  onThemeResolved: (callback: (isDark: boolean) => void) => () => void;
  get: () => Promise<SettingsEnvelope>;
  set: (patch: RendererSettingsPatch) => Promise<SettingsEnvelope>;
  mutateMemory: (
    mutation: MemorySettingsMutation
  ) => Promise<SettingsEnvelope>;
  onChanged: (callback: (envelope: SettingsEnvelope) => void) => () => void;
  getChatHomeStatus: () => Promise<ChatHomeStatus>;
  onChatHomeStatus?: (callback: (status: ChatHomeStatus) => void) => () => void;
  chooseChatHomesRoot: () => Promise<ChatHomeStatus | null>;
  /** null when no home-level name is free; nothing is created until the suggestion is opened. */
  suggestChatHomesRoot?: () => Promise<LibrarySuggestion | null>;
  /** Opens the suggestion exactly as shown; refused when the folder at that path changed since. */
  openSuggestedChatHomesRoot?: (path: string) => Promise<ChatHomeStatus>;
  /** Reopens the folder already configured; a failed first open must not ask for the path again. */
  retryLibrary?: () => Promise<ChatHomeStatus>;
  revealLibrary?: () => Promise<void>;
  /** Asks where the folder should go; null when the picker was cancelled. Nothing is written yet. */
  planLibraryMove?: () => Promise<LibraryMovePlan | null>;
  /** Records the move and restarts Bottega, which moves the folder before opening it. */
  commitLibraryMove?: (planId: string) => Promise<void>;
  /** Records the erase and restarts Bottega, which erases this computer's data before opening anything. */
  eraseAllData?: (options: { trashFolder: boolean; token: string }) => Promise<void>;
  /** Whether the Bottega folder holds files Bottega did not create; moving it to the Trash would take them too. */
  inspectEraseFolder?: () => Promise<{ foreignEntries: boolean; token: string }>;
  /** An App window names the Chat resident in it that is switching to Full Access; the main window names none. */
  acknowledgeFullAccess: (input?: { chatId: string }) => Promise<SettingsEnvelope>;
  listBackends: () => Promise<BackendInfo[]>;
  listModels: (
    backend: ProviderId,
    scope: AgentWorkspaceScope
  ) => Promise<BackendModelInfo[] | ProviderIpcRefusal>;
  /** Per-Agent options; no id uses the last-used Agent, falling back to the configured default. */
  getBackendDefaults: (backend?: AgentBackendId) => Promise<ChatTurnOptions | ProviderIpcRefusal>;
  rememberChatDefaults: (options: ChatTurnOptions, preference?: ChatPreferenceWrite) => Promise<SettingsEnvelope | ProviderIpcRefusal>;
  patchChatOptions: (input: import("../../chat-agent/contracts").ChatOptionsPatch, resetSessionEffective?: boolean) => Promise<{
    agent: AgentBackendId; agentRevision: number; chatRecordRevision: number; options: AgentTurnOptions;
  } | ProviderIpcRefusal>;

};

export type CodexModelInfo = BackendModelInfo & {
  defaultReasoningEffort: string;
  supportedReasoningEfforts: NonNullable<
    BackendModelInfo["supportedReasoningEfforts"]
  >;
  serviceTiers: NonNullable<BackendModelInfo["serviceTiers"]>;
};
