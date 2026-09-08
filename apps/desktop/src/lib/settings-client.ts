/**
 * [INPUT]: Depends on shared/settings-ipc and preload exposed window.settings
 * [OUTPUT]: Provides settings get/set/subscriptions, Memory and Chat Home controls, initial language/theme facts, backend/model catalogs, and scoped chat options with explicit session-effective reset; throws when the bridge is absent
 * [POS]: The main process of lib sets the IPC's only output and unifies the default model, scope, consolidation and renderer to display semantics
 */

import type {
  MemorySettingsMutation,
  RendererSettingsPatch,
  SettingsBridgeApi,
  SettingsEnvelope,
} from "../../shared/settings-ipc";
import type {
  AgentBackendId,
  AgentTurnOptions,
  AgentWorkspaceScope,
  BackendModelInfo,
} from "../../shared/agent-ipc";

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

const bridge = (): SettingsBridgeApi => {
  const api = window.settings;
  if (!api) throw new Error("settings bridge unavailable");
  return api;
};

export const getSettings = (): Promise<SettingsEnvelope> => bridge().get();

export const setSettings = (
  patch: RendererSettingsPatch
): Promise<SettingsEnvelope> => bridge().set(patch);

/* Memory 只有这一个出口：通用 set 在 type 与 main 运行时都已拒绝它。 */
export const mutateMemorySettings = (
  mutation: MemorySettingsMutation
): Promise<SettingsEnvelope> => bridge().mutateMemory(mutation);

export const subscribeSettings = (
  listener: (envelope: SettingsEnvelope) => void
) => bridge().onChanged(listener);

export const chooseChatHomesRoot = () => bridge().chooseChatHomesRoot();

export const acknowledgeFullAccess = (): Promise<SettingsEnvelope> =>
  bridge().acknowledgeFullAccess();

export const initialAppLanguage = () => bridge().initialLanguage;

/* 有效主题由 main 解析后送来：初值随建窗参数到达 preload，此后每次变化
   都是同一个布尔广播，调用方因此没有 auto 分支。 */
export const initialDarkTheme = () => bridge().initialDark;

export const subscribeResolvedTheme = (
  callback: (isDark: boolean) => void
) => bridge().onThemeResolved(callback);

export const listBackends = () => bridge().listBackends();

export const listModels = (
  backend: AgentBackendId,
  scope: AgentWorkspaceScope
) => bridge().listModels(backend, scope);

export const getBackendDefaults = (backend?: AgentBackendId) => bridge().getBackendDefaults(backend);
export const rememberChatDefaults = (options: AgentTurnOptions) => bridge().rememberChatDefaults(options);
export const patchChatOptions = (input: import("../../shared/chat-agent/contracts").ChatOptionsPatch, reset = false) => bridge().patchChatOptions(input, reset);
