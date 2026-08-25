/**
 * [INPUT]: Depends on the shared/agent-ipc backend, workspace scope, model and turn-by-turn combined type
 * [OUTPUT]: Provides settings v11 ((Use price refreshment, Chat Home dual mode, chat only read, built-in toolset shutdown, automatic connection, theme/language preferences, sparse keyboard-shortcut overrides (ShortcutBinding | null) and three-level Memory sharing range), revision envelope, Memory special mutation, CHAT_HOME_NOT_READY assertion code and a special API agreement
 * [POS]: The first is the shared multi-end setup of a single truth sourcemain, preload, renderer only by this contract
 */

import type {
  AgentBackendId,
  AgentScope,
  AgentTurnOptions,
  AgentWorkspaceScope,
  BackendInfo,
  BackendModelInfo,
} from "./agent-ipc";
import type { AppLocale, LanguagePreference } from "./i18n/locale";

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
  /** 只能经 Chat Home 专用 API 修改。 */
  chatHomesRoot: string | null;
  /** 只能经 Chat Home 专用 API 修改。 */
  chatHomeState: ChatHomeState;
  allowCrossChatRead: boolean;
  /** 宽松持久化、消费时与当前 ambient 工具集求交；下一轮 turn 生效。 */
  disabledBuiltinTools: readonly string[];
  /** 只能经 acknowledgeFullAccess 写入。 */
  fullAccessAcknowledgedAt: number | null;
  /** auto 表示交还平台；main 据此设定 nativeTheme.themeSource。 */
  theme: ThemePreference;
  /** auto 按系统首选语言解析，未命中受支持语言时回落英语。 */
  language: LanguagePreference;
  titleAgent: AgentBackendId | "auto";
  titleModelByBackend: Partial<Record<AgentBackendId, string | null>>;
  defaultChatOptionsByBackend: DefaultChatOptionsByBackend;
  lastSelectedBackend: AgentBackendId;
  /** 每条跨 Section 链可自动触发的 turn 数；0 表示无限。 */
  autoRelayLimit: number;
  /** Usage 页是否允许按 24h TTL 从 models.dev 自动刷新价格。 */
  usagePricingAutoRefresh: boolean;
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
    | "chatHomeState"
    | "fullAccessAcknowledgedAt"
    | "memory"
  >
>;

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
  chooseChatHomesRoot: "settings:chat-home:choose-root",
  chatHomeStatus: "settings:chat-home:status",
  acknowledgeFullAccess: "settings:full-access:acknowledge",
  listBackends: "settings:list-backends",
  listModels: "settings:list-models",
  resolveChatOptions: "settings:resolve-chat-options",
  setChatOptions: "settings:set-chat-options",
} as const;

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
  chooseChatHomesRoot: () => Promise<ChatHomeStatus | null>;
  onChatHomeStatus: (
    callback: (status: ChatHomeStatus) => void
  ) => () => void;
  acknowledgeFullAccess: () => Promise<SettingsEnvelope>;
  listBackends: () => Promise<BackendInfo[]>;
  listModels: (
    backend: AgentBackendId,
    scope: AgentWorkspaceScope
  ) => Promise<BackendModelInfo[]>;
  resolveChatOptions: (
    scope: AgentScope,
    backend?: AgentBackendId
  ) => Promise<AgentTurnOptions>;
  setChatOptions: (
    scope: AgentScope,
    options: AgentTurnOptions
  ) => Promise<AgentTurnOptions>;
};

// 旧名称只保留类型源兼容；模型 DTO 已由 agent-ipc 统一。
export type CodexReasoningEffortInfo =
  import("./agent-ipc").BackendReasoningEffortInfo;
export type CodexServiceTierInfo =
  import("./agent-ipc").BackendServiceTierInfo;
export type CodexModelInfo = BackendModelInfo & {
  defaultReasoningEffort: string;
  supportedReasoningEfforts: NonNullable<
    BackendModelInfo["supportedReasoningEfforts"]
  >;
  serviceTiers: NonNullable<BackendModelInfo["serviceTiers"]>;
};
