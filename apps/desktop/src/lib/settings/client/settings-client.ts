/**
 * [INPUT]: Depends on shared/settings-ipc, the Provider IPC refusal check (shared/providers/catalog) and preload exposed window.settings
 * [OUTPUT]: Typed Settings/Chat preference commands, per-Agent defaults/catalogs, scoped Chat option writes, Memory and Chat Home controls; rejects a missing bridge.
 * [POS]: apps/desktop/src/lib/settings/client; getBackendDefaults answers a named built-in in its own shape and the default Agent (no id) as ChatTurnOptions, since it may be a package Provider (TASK-11 S3-d). A Provider refusal from main reads as an empty model list, or fails a required value with the bare PROVIDER_UNAVAILABLE code (TASK-11 S3-c). The main process of lib sets the IPC's only output and unifies the default model, scope, consolidation and renderer to display semantics
 */

import type { ChatTurnOptions } from "../../../../shared/chat-agent/options";
import type {
  MemorySettingsMutation,
  RendererSettingsPatch,
  SettingsBridgeApi,
  SettingsEnvelope,
} from "../../../../shared/ipc/settings/settings-ipc";
import type {
  AgentBackendId,
  AgentTurnOptions,
  AgentWorkspaceScope,
  BackendModelInfo,
} from "../../../../shared/ipc/agent/agent-ipc";
import { isProviderIpcRefusal, type ProviderIpcRefusal } from "../../../../shared/providers/catalog-ipc";

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

/* Surfaces without a settings bridge (App windows, isolated tests) simply hear no broadcasts; reads still fail loudly. */
export const subscribeSettings = (
  listener: (envelope: SettingsEnvelope) => void
) => window.settings?.onChanged(listener) ?? (() => {});

export const chooseChatHomesRoot = () => bridge().chooseChatHomesRoot();
export const suggestChatHomesRoot = () => bridge().suggestChatHomesRoot?.() ?? Promise.resolve(null);
export const openSuggestedChatHomesRoot = (path: string) =>
  bridge().openSuggestedChatHomesRoot?.(path) ?? Promise.resolve(null);
/* Retry never shows a dialog: a configured folder can only be reopened in place,
   changing folders isn't supported. */
export const retryLibrary = () => bridge().retryLibrary?.() ?? Promise.resolve(null);
export const subscribeChatHomeStatus = (listener: (status: import("../../../../shared/ipc/settings/settings-ipc").ChatHomeStatus) => void) =>
  window.settings?.onChatHomeStatus?.(listener) ?? (() => {});

export const acknowledgeFullAccess = (input?: { chatId: string }): Promise<SettingsEnvelope> =>
  bridge().acknowledgeFullAccess(input);

export const initialAppLanguage = () => bridge().initialLanguage;

/* 有效主题由 main 解析后送来：初值随建窗参数到达 preload，此后每次变化
   都是同一个布尔广播，调用方因此没有 auto 分支。 */
export const initialDarkTheme = () => bridge().initialDark;

export const subscribeResolvedTheme = (
  callback: (isDark: boolean) => void
) => bridge().onThemeResolved(callback);

export const listBackends = () => bridge().listBackends();

/* TASK-11 S3-c: main answers a malformed or unknown Provider id with a typed refusal. A list reads it as empty; a value the caller
   cannot go on without fails with the bare PROVIDER_UNAVAILABLE code, which the shared error copy never shows as text. */
const refused = (channel: string, refusal: ProviderIpcRefusal) =>
  console.warn(`[settings] ${channel} refused: ${refusal.status}${refusal.status === "unknown-provider" ? ` ${refusal.id}` : ""}`);
async function required<T>(channel: string, answer: Promise<T | ProviderIpcRefusal>): Promise<T> {
  const value = await answer;
  if (!isProviderIpcRefusal(value)) return value;
  refused(channel, value);
  throw new Error("PROVIDER_UNAVAILABLE");
}

export const listModels = async (
  backend: string,
  scope: AgentWorkspaceScope
): Promise<BackendModelInfo[]> => {
  const models = await bridge().listModels(backend, scope);
  if (!isProviderIpcRefusal(models)) return models;
  refused("list-models", models);
  return [];
};

/* A named built-in answers its own shape; the default Agent (no id) may be a package Provider (TASK-11 S3-d). */
export function getBackendDefaults(backend: AgentBackendId): Promise<AgentTurnOptions>;
export function getBackendDefaults(): Promise<ChatTurnOptions>;
export async function getBackendDefaults(backend?: AgentBackendId): Promise<ChatTurnOptions> {
  const options = await required("backend-defaults", bridge().getBackendDefaults(backend));
  if (backend !== undefined && options.backend !== backend) throw new Error("PROVIDER_UNAVAILABLE");
  return options;
}
export const rememberChatDefaults = (options: ChatTurnOptions, preference?: import("../../../../shared/chat-agent/preferences").ChatPreferenceWrite) =>
  required("remember-chat-defaults", bridge().rememberChatDefaults(options, preference));
export const patchChatOptions = (input: import("../../../../shared/chat-agent/contracts").ChatOptionsPatch, reset = false) =>
  required("patch-chat-options", bridge().patchChatOptions(input, reset));
