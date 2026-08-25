/**
 * [INPUT]: Depends on shared/settings-ipc and preload exposed window.settings
 * [OUTPUT]: Provides revision Covered version get/set, Memory exclusive mutation, settings: changed Subscriptions, Casting valid language, Chat Home/Built-in tools with title/chat model packages and browser settings downgrade
 * [POS]: The main process of lib sets the IPC's only output and unifies the default model, scope, consolidation and renderer to display semantics
 */

import type {
  AppSettings,
  MemorySettingsMutation,
  RendererSettingsPatch,
  SettingsBridgeApi,
  SettingsEnvelope,
} from "../../shared/settings-ipc";
import type {
  AgentBackendId,
  AgentScope,
  AgentTurnOptions,
  AgentWorkspaceScope,
  BackendInfo,
  BackendModelInfo,
} from "../../shared/agent-ipc";
import { resolveAppLocale } from "../../shared/i18n/locale";

export const DEFAULT_TITLE_MODEL_VALUE = "__default__";

export type TitleModelOption = {
  value: string;
  label: string;
};

export function buildTitleModelOptions(
  models: BackendModelInfo[],
  titleModel: string | null,
  labels: {
    defaultModelUnavailable: string;
    currentModelUnavailable: (model: string) => string;
  } = {
    defaultModelUnavailable: "Default (model name unavailable)",
    currentModelUnavailable: (model) => `${model} (currently unavailable)`,
  }
): TitleModelOption[] {
  const hasDefault = models.some((model) => model.isDefault);
  const options = [
    ...(hasDefault
      ? []
      : [
          {
            value: DEFAULT_TITLE_MODEL_VALUE,
            label: labels.defaultModelUnavailable,
          },
        ]),
    ...models.map((model) => ({
      value: model.slug,
      label: model.displayName,
    })),
  ];
  if (titleModel && !models.some((model) => model.slug === titleModel)) {
    options.push({
      value: titleModel,
      label: labels.currentModelUnavailable(titleModel),
    });
  }
  return options;
}

export function selectedTitleModelValue(
  titleModel: string | null,
  models: BackendModelInfo[]
) {
  return (
    titleModel ??
    models.find((model) => model.isDefault)?.slug ??
    DEFAULT_TITLE_MODEL_VALUE
  );
}

export function persistedTitleModelValue(
  value: string,
  models: BackendModelInfo[]
) {
  const defaultSlug = models.find((model) => model.isDefault)?.slug;
  return value === DEFAULT_TITLE_MODEL_VALUE || value === defaultSlug
    ? null
    : value;
}

declare global {
  interface Window {
    settings?: SettingsBridgeApi;
  }
}

const browserDefaultChatOptions: AgentTurnOptions = {
  backend: "codex",
  model: "gpt-5.6-sol",
  reasoningEffort: "xhigh",
  serviceTier: "priority",
  permissionMode: "approve-for-me",
};
let browserSettings: AppSettings = {
  chatHomesRoot: null,
  chatHomeState: "unconfigured",
  allowCrossChatRead: false,
  disabledBuiltinTools: [],
  fullAccessAcknowledgedAt: null,
  theme: "auto",
  language: "auto",
  titleAgent: "auto",
  titleModelByBackend: { codex: null },
  defaultChatOptionsByBackend: {
    codex: browserDefaultChatOptions,
    claude: { backend: "claude", permissionMode: "ask-for-approval" },
    kimi: { backend: "kimi", permissionMode: "ask-for-approval" },
    opencode: { backend: "opencode", permissionMode: "ask-for-approval" },
  },
  lastSelectedBackend: "codex",
  autoRelayLimit: 25,
  usagePricingAutoRefresh: true,
  keyboardShortcuts: {},
  memory: {
    enabled: false,
    paused: false,
    provider: "openviking",
    sharingMode: "chat",
    pendingRevision: null,
    applyStatus: null,
  },
};
let browserRevision = 1;
const browserChatOptions = new Map<string, AgentTurnOptions>();

const scopeKey = (scope: AgentScope) => `general:${scope.conversationId}`;

function optionsForNextConversation(options: AgentTurnOptions) {
  if (
    options.backend !== "claude" ||
    options.reasoningEffort !== "max"
  ) {
    return options;
  }
  const defaults = { ...options };
  delete defaults.reasoningEffort;
  return defaults;
}

export const getSettings = (): Promise<SettingsEnvelope> =>
  window.settings?.get() ??
  Promise.resolve({ revision: browserRevision, settings: { ...browserSettings } });

export const setSettings = async (
  patch: RendererSettingsPatch
): Promise<SettingsEnvelope> => {
  if (window.settings) return window.settings.set(patch);
  browserSettings = { ...browserSettings, ...patch };
  browserRevision += 1;
  return { revision: browserRevision, settings: { ...browserSettings } };
};

/* Memory 只有这一个出口：通用 set 在 type 与 main 运行时都已拒绝它。 */
export const mutateMemorySettings = async (
  mutation: MemorySettingsMutation
): Promise<SettingsEnvelope> => {
  if (window.settings) return window.settings.mutateMemory(mutation);
  const memory = { ...browserSettings.memory };
  if (mutation.kind === "enable-with-consent") {
    memory.enabled = true;
    memory.paused = false;
  }
  if (mutation.kind === "cutover-with-consent") {
    memory.provider = mutation.providerId;
    memory.enabled = true;
    memory.paused = false;
  }
  if (mutation.kind === "set-paused") memory.paused = mutation.paused;
  browserSettings = { ...browserSettings, memory };
  browserRevision += 1;
  return { revision: browserRevision, settings: { ...browserSettings } };
};

/* 唯一在模块加载期就被调用的桥接口：store 单例在构造时即订阅。
   纯 Node 测试里没有 window，触碰全局就会在 import 阶段炸掉。 */
export const subscribeSettings = (
  listener: (envelope: SettingsEnvelope) => void
) =>
  (typeof window === "undefined" ? undefined : window.settings)?.onChanged(
    listener
  ) ?? (() => {});

export const chooseChatHomesRoot = async () => {
  if (!window.settings) return null;
  const status = await window.settings.chooseChatHomesRoot();
  browserSettings = (await window.settings.get()).settings;
  return status;
};

export const acknowledgeFullAccess = async (): Promise<SettingsEnvelope> => {
  if (!window.settings) {
    browserSettings = {
      ...browserSettings,
      fullAccessAcknowledgedAt: Date.now(),
    };
    browserRevision += 1;
    return { revision: browserRevision, settings: { ...browserSettings } };
  }
  return window.settings.acknowledgeFullAccess();
};

export const hasSettingsBridge = () => Boolean(window.settings);

export const initialAppLanguage = () =>
  window.settings?.initialLanguage ??
  resolveAppLocale("auto", globalThis.navigator?.languages ?? ["en"]);

/* ── 有效主题：Electron 下由 main 解析后送来，浏览器下退回系统偏好 ──
   两条路都只给「现在是不是深色」这一个布尔，调用方因此没有 auto 分支。 */
const darkQuery = () =>
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

export const initialDarkTheme = () =>
  window.settings?.initialDark ?? darkQuery()?.matches ?? false;

export const subscribeResolvedTheme = (
  callback: (isDark: boolean) => void
) => {
  if (window.settings) return window.settings.onThemeResolved(callback);
  const query = darkQuery();
  if (!query) return () => undefined;
  const handler = (event: MediaQueryListEvent) => callback(event.matches);
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
};

const browserBackends: BackendInfo[] = [
  {
    id: "codex",
    displayName: "Codex",
    status: "ready",
    runtimeStatus: "installed",
    authStatus: "authenticated",
    capabilities: {
      resume: true,
      permissionModes: ["ask-for-approval", "approve-for-me", "full-access"],
      modelOptions: "full",
      imageInput: true,
      planMode: true,
      headless: ["install-analysis", "repair", "serve"],
      maintenance: true,
      builtinTools: "none",
    },
  },
  ...(["claude", "kimi"] as const).map((id): BackendInfo => ({
    id,
    displayName: id === "claude" ? "Claude" : "Kimi",
    status: "ready" as const,
    runtimeStatus: "installed" as const,
    authStatus: "authenticated" as const,
    capabilities: {
      resume: true,
      permissionModes: ["ask-for-approval", "approve-for-me"],
      modelOptions: "list-only",
      imageInput: id === "claude",
      planMode: true,
      headless: [],
      maintenance: false,
      builtinTools: "none",
    },
  })),
  /* OpenCode 在浏览器演示里保持它在真机上的形状：无 auth 扩展故
     authStatus 恒 unknown（入场靠首轮试错），权限两档无 full-access，
     模型目录为空——mock 若比真身宽松，演示就成了另一个产品。 */
  {
    id: "opencode",
    displayName: "OpenCode",
    status: "ready",
    runtimeStatus: "installed",
    authStatus: "unknown",
    capabilities: {
      resume: true,
      permissionModes: ["ask-for-approval", "approve-for-me"],
      modelOptions: "list-only",
      imageInput: true,
      planMode: true,
      headless: [],
      maintenance: false,
      builtinTools: "none",
    },
  },
];

const browserModels: Partial<Record<AgentBackendId, BackendModelInfo[]>> = {
  codex: [
    {
      slug: "gpt-5.6-sol",
      displayName: "GPT-5.6 Sol",
      isDefault: true,
      defaultReasoningEffort: "xhigh",
      supportedReasoningEfforts: [
        { effort: "medium", displayName: "Medium", description: "" },
        { effort: "high", displayName: "High", description: "" },
        { effort: "xhigh", displayName: "X-High", description: "" },
      ],
    },
    {
      slug: "gpt-5.6-codex",
      displayName: "GPT-5.6 Codex",
      isDefault: false,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: [
        { effort: "medium", displayName: "Medium", description: "" },
        { effort: "high", displayName: "High", description: "" },
      ],
    },
  ],
  claude: [
    {
      slug: "claude-fable-5[1m]",
      displayName: "Fable 5",
      isDefault: false,
    },
    {
      slug: "opus[1m]",
      displayName: "Opus 5",
      isDefault: true,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: [
        { effort: "low", displayName: "Low", description: "" },
        { effort: "medium", displayName: "Medium", description: "" },
        { effort: "high", displayName: "High", description: "" },
      ],
    },
    {
      slug: "sonnet",
      displayName: "Sonnet 5",
      isDefault: false,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: [
        { effort: "low", displayName: "Low", description: "" },
        { effort: "medium", displayName: "Medium", description: "" },
        { effort: "high", displayName: "High", description: "" },
        { effort: "max", displayName: "Max", description: "" },
      ],
    },
    {
      slug: "haiku",
      displayName: "Haiku 4.5",
      isDefault: false,
    },
  ],
  kimi: [
    {
      slug: "kimi-code/k3",
      displayName: "K3",
      isDefault: true,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: [
        { effort: "low", description: "" },
        { effort: "high", description: "" },
        { effort: "max", description: "" },
      ],
    },
    {
      slug: "kimi-code/k3-256k",
      displayName: "K3-256k",
      isDefault: false,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: [
        { effort: "low", description: "" },
        { effort: "high", description: "" },
        { effort: "max", description: "" },
      ],
    },
  ],
  /* 真机的 `opencode models` 无凭据时可能一行不吐；空目录是合法态，
     模型选择器必须能在无默认项的目录上正常呈现（P0.8 验收面）。 */
  opencode: [],
};

export const listBackends = () =>
  window.settings?.listBackends() ??
  Promise.resolve(structuredClone(browserBackends));

export const listModels = (
  backend: AgentBackendId,
  scope: AgentWorkspaceScope
) =>
  window.settings?.listModels(backend, scope) ??
  Promise.resolve(structuredClone(browserModels[backend] ?? []));

export const resolveChatOptions = async (
  scope: AgentScope,
  backend?: AgentBackendId
) => {
  if (window.settings) return window.settings.resolveChatOptions(scope, backend);
  const key = scopeKey(scope);
  const current = browserChatOptions.get(key);
  if (current) return { ...current };
  const selected = backend ?? browserSettings.lastSelectedBackend;
  const options =
    browserSettings.defaultChatOptionsByBackend[selected] ??
    browserDefaultChatOptions;
  browserChatOptions.set(key, options);
  return { ...options };
};

export const setChatOptions = async (
  scope: AgentScope,
  options: AgentTurnOptions
) => {
  if (window.settings) return window.settings.setChatOptions(scope, options);
  const next = { ...options };
  const defaults = optionsForNextConversation(next);
  browserChatOptions.set(scopeKey(scope), next);
  browserSettings = {
    ...browserSettings,
    lastSelectedBackend: next.backend,
    defaultChatOptionsByBackend: {
      ...browserSettings.defaultChatOptionsByBackend,
      [next.backend]: defaults,
    },
  };
  return { ...next };
};
