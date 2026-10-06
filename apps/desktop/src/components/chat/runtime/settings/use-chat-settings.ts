/**
 * [INPUT]: Canonical Chat/Agent drafts, shared preference policy, scoped model catalogs, Settings IPC, window role, warm-up and Setup invalidation events.
 * [OUTPUT]: Revision-fenced Chat options, preference learning, accepted-use callbacks and live defaults for factory drafts; remembered choices remain usable, and send preparation receives results across display refreshes.
 * [POS]: apps/desktop/src/components/chat/runtime/settings; Composer settings owner; canonical commit and default learning are separate operations
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentBackendId, AgentScope, AgentTurnOptions, AgentWorkspaceScope, BackendInfo, BackendModelInfo } from "../../../../../shared/ipc/agent/agent-ipc";
import { listModels, patchChatOptions, rememberChatDefaults } from "@/lib/settings/client/settings-client";
import { readAgentDraft, receiveCanonicalAgent, updateAgentDraft } from "@/lib/chat-agent-draft/state";
import type { ChatRuntimeContext } from "../../../../../shared/ipc/content/chats-ipc";
import type { ProjectWorkspaceBinding } from "../../../../../shared/ipc/workspace/projects-ipc";
import { optionsForListModel } from "@ai-chat/chat-ui/models/selection";
import { builtinAgent, builtinOptions, turnOptionsSchema, type ChatAgentId, type ChatTurnOptions } from "../../../../../shared/chat-agent/options";
import { errorMessage, failureCode } from "@ai-chat/ui/lib/errors";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { backendLabel, draftStartProvider, isAgentBackendId } from "@/lib/agent/agent-backends";
import { providerCatalogStore } from "@/lib/provider-catalog/store";
import { settingsStore } from "@/lib/settings/store/settings-store";
import { rendererAgentSurfaceFailure, type AgentSurfaceFailure } from "@/lib/agent/agent-failure";
import { useEffectiveLocale } from "@/lib/appearance/i18n-locale";
import { markStartup } from "@/lib/platform/startup-marks";
import { onSetupEvent } from "@/lib/settings/setup/setup-client";
import { hintProviderWarmup } from "@/lib/agent/provider-warmup";
import { windowContext } from "@/lib/platform/window-surfaces-client";
import { catalogChatOptions, createChatPreferenceIntents, isFactoryChatOptions } from "../../../../../shared/chat-agent/preferences";
import { translate } from "../../../../../shared/i18n/runtime";
import { usePendingAgent } from "../agent-switch/use-pending-agent";

/* 裸机器码经 errorMessage 会被抹成空串（packages/ui/src/lib/errors.ts 的
   BARE_MACHINE_CODE），"保存失败：" 后面于是什么都没有。CHAT_NOT_WRITABLE 是
   这条路径上唯一的裸码，复用 Chat 已经在用的那两句只读/归档文案。 */
function saveFailureCopy(locale: AppLocale, cause: unknown, canonical: ChatRuntimeContext) {
  if (failureCode(cause) === "CHAT_NOT_WRITABLE") {
    return translate(locale, canonical.archivedAt ? "chat.agentSwitch.archived" : "chat.agentSwitch.readonly");
  }
  return translate(locale, "chat.runtime.settings.saveFailed", { message: errorMessage(cause) });
}

/* The draft's own object when it is a built-in's (never a re-parsed copy): the controls edit exactly what the draft holds. */
const isBuiltinTurnOptions = (options: ChatTurnOptions): options is AgentTurnOptions => builtinAgent(options.backend) !== null;
const preferenceIntents = createChatPreferenceIntents();

export function useChatSettings(scope: AgentScope, requestedModelScope: AgentWorkspaceScope | null,
  backends: BackendInfo[], retryBackends: () => Promise<void>, draftBackend?: AgentBackendId, workspaceScopeKey = "",
  workspaceBinding: ProjectWorkspaceBinding | null = null) {
  const chatId = scope.conversationId;
  const locale = useEffectiveLocale();
  /* Read at the moment a draft starts: the catalog, the person's order and this computer's Setup facts decide where it can run. */
  const backendsRef = useRef(backends);
  useLayoutEffect(() => { backendsRef.current = backends; }, [backends]);
  const startOn = useCallback((id: ChatAgentId) => draftStartProvider(id, settingsStore.getSnapshot().settings, providerCatalogStore.getSnapshot(),
    backendsRef.current, Date.now()), []);
  const pending = usePendingAgent(chatId, draftBackend, startOn);
  const { state, error: pendingError, initFailure, select: pendingSelect, refresh: pendingRefresh, undo: pendingUndo } = pending;
  // Canonical options can arrive before the session's workspace projection.
  const canonicalChatId = state.canonical?.id;
  const modelScope = useMemo<AgentWorkspaceScope | null>(() => requestedModelScope && canonicalChatId
    ? { kind: "conversation", conversationId: canonicalChatId } : requestedModelScope,
  [canonicalChatId, requestedModelScope]);
  const modelScopeKey = JSON.stringify(modelScope);
  const backend = state.options.backend;
  const descriptor = backends.find(entry => entry.id === backend);
  const environment = descriptor?.availability?.environmentGeneration;
  const modelOptions = descriptor?.capabilities.modelOptions;
  const modelKey = JSON.stringify([chatId, backend, environment, modelScopeKey, workspaceScopeKey, state.canonical?.incarnationId]);
  const [modelsOwner, setModelsOwner] = useState("");
  const turnOptions = state.options;
  /* The built-in-only controls (permission, model, effort, speed) read this view; a package Provider has none of them this period. */
  const builtinTurnOptions = isBuiltinTurnOptions(turnOptions) ? turnOptions : null;
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [models, setModels] = useState<BackendModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<AgentSurfaceFailure | null>(null);
  const modelGeneration = useRef(0);
  const reconciledModel = useRef("");
  const explicitModelChoice = useRef(new Set<string>());
  const activeChat = useRef(chatId);
  const activeModelKey = useRef(modelKey);
  const modelScopeRef = useRef(modelScope);
  useLayoutEffect(() => { activeChat.current = chatId; activeModelKey.current = modelKey; modelScopeRef.current = modelScope; }, [chatId, modelKey, modelScope]);
  const rememberOptions = useCallback(async (options: ChatTurnOptions, intent: number | null, quiet = false, expectedModel?: string, agentOnly = false) => {
    if (intent === null && expectedModel === undefined) return;
    if (windowContext().role !== "main" || intent !== null && !preferenceIntents.isLatestForBackend(options.backend, intent)) return;
    try {
      await rememberChatDefaults(options, { preferForNewChat: intent !== null && preferenceIntents.isLatest(intent),
        agentOnly,
        ...(expectedModel !== undefined ? { expectedModel } : {}) });
    } catch {
      if (!quiet && activeChat.current === chatId) setSettingsError(translate(locale, "chat.agentSwitch.defaultsFailed"));
    }
  }, [chatId, locale]);
  /* `quiet` 属于对账这类没人按过按钮的写入：回滚照做，但不许冒出一条用户
     没发起过的报错。用户自己的保存永远走 quiet=false。 */
  const writeTurnOptions = useCallback(async (next: AgentTurnOptions, reset: boolean, quiet: boolean) => {
    const captured = readAgentDraft(chatId);
    if (captured.adoption || captured.pending?.submitting) throw new Error("AGENT_SWITCH_SUBMITTING");
    if (captured.options.backend !== next.backend) throw new Error("AGENT_SELECTION_REQUIRED");
    const intent = quiet ? null : preferenceIntents.begin(next.backend);
    if (!quiet) explicitModelChoice.current.add(`${chatId}:${next.backend}`);
    updateAgentDraft(chatId, current => ({ ...current, options: next }));
    if (!quiet) {
      setSettingsError("");
      hintProviderWarmup(next.backend);
    }
    if (captured.pending || !captured.canonical) {
      await rememberOptions(next, intent, quiet, quiet ? captured.options.model : undefined);
      return;
    }
    const canonical = captured.canonical;
    setSettingsSaving(true);
    try {
      const { backend: _backend, ...patch } = next;
      /* A package Provider's Chat has no options to patch this period (TASK-11 S3-b); main refuses it too. */
      if (!isAgentBackendId(canonical.agent)) throw new Error("PROVIDER_UNAVAILABLE");
      const saved = await patchChatOptions({ chatId, expectedAgent: canonical.agent,
        expectedAgentRevision: canonical.agentRevision, expectedChatRecordRevision: canonical.chatRecordRevision, patch }, reset);
      receiveCanonicalAgent(chatId, { ...canonical, ...saved });
      await rememberOptions(next, intent, quiet, quiet ? captured.options.model : undefined);
    } catch (cause) {
      updateAgentDraft(chatId, current => current.generation === captured.generation ? { ...current, options: captured.options } : current);
      if (quiet) console.debug("[chat:options] quiet write rejected", failureCode(cause) || errorMessage(cause));
      else if (activeChat.current === chatId) setSettingsError(saveFailureCopy(locale, cause, canonical));
      throw cause;
    } finally {
      if (activeChat.current === chatId) setSettingsSaving(false);
    }
  }, [chatId, locale, rememberOptions]);
  const updateTurnOptions = useCallback((next: AgentTurnOptions, reset = false) =>
    writeTurnOptions(next, reset, false), [writeTurnOptions]);
  /* ── 目录里没有的模型必须当场换掉 ───────────────────────────────
     账号默认模型被 CLI 淘汰后（见 providers/codex/background/models.ts 排除的占位项），
     旧草稿与「记住的默认值」仍钉着那个 slug。放着不管，用户要按下发送才会
     撞上 `模型不在可信候选列表中`——一句他自己从没选过的错。目录一到就换成
     目录默认模型，走的是同一条 revision-fenced 写入，只是静默：canonical 与
     记住的默认值一起被治好，而没人按过的写入失败时也不弹保存错误。 */
  const reconcileModel = useCallback((catalog: BackendModelInfo[]) => {
    /* 唯一没有目录的形态是 modelOptions:"none"——那种后端根本不接受 renderer
       指定模型。其余两种（Codex 的 "full"、其他三家的 "list-only"）的模型都只
       能从这份目录里挑，差别仅在 Effort/Speed 是否也可选，所以同样适用。 */
    if (modelOptions === "none" || catalog.length === 0) return;
    const draft = readAgentDraft(chatId);
    const options = builtinOptions(draft.options);
    if (!options || draft.loading || !draft.initialized) return;
    const slug = "model" in options ? options.model : undefined;
    if (options.backend !== backend) return;
    const canonical = draft.canonical;
    const remembered = settingsStore.getSnapshot().settings?.defaultChatOptionsByBackend[options.backend]?.model;
    const initial = !canonical && !remembered && isFactoryChatOptions(options) && !explicitModelChoice.current.has(`${chatId}:${backend}`);
    if (!initial && (!slug || catalog.some(entry => entry.slug === slug))) return;
    if (draft.pending || draft.adoption) return;
    /* 判据比 switchLocked 更严，两者并不同义：switchLocked 放行
       external-readonly，因为导入的 Chat 允许走显式切换流程；而这里是替它
       改写已记录的选项——主进程的 patchChatOptions 对任何 readOnlyReason 或
       archivedAt 一律抛 CHAT_NOT_WRITABLE，况且导入 Chat 记的是原生会话的
       历史事实，不是一份我们可以代劳修正的偏好。 */
    if (canonical && (canonical.archivedAt || canonical.readOnlyReason
      || canonical.context.kind !== "ordinary")) return;
    const target = catalog.find(entry => entry.isDefault) ?? catalog[0]!;
    /* 目录可以不给某个模型报 Effort，而 Codex 的选项契约要求它——换出来的
       形状自己过一遍契约，换不出合法选项就宁可不动。 */
    const next = turnOptionsSchema.safeParse(initial ? catalogChatOptions(options, target) : optionsForListModel(options, target));
    if (!next.success) return;
    /* 一份目录对一个坏 slug 只替一次：替成功后判据自然不再成立，替失败
       （CAS 撞车、只读拒绝）也不许变成每次刷新都重放的循环。 */
    const attempt = `${modelKey}\u0000${slug}`;
    if (reconciledModel.current === attempt) return;
    reconciledModel.current = attempt;
    void writeTurnOptions(next.data as AgentTurnOptions, false, true).catch(() => {});
  }, [backend, chatId, modelKey, modelOptions, writeTurnOptions]);
  /* The catalog reader's identity stays keyed to the catalog alone; reaching the
     reconciler through a ref keeps locale and capability changes from restarting
     discovery. */
  const reconcileRef = useRef(reconcileModel);
  useLayoutEffect(() => { reconcileRef.current = reconcileModel; }, [reconcileModel]);
  /* A Project whose folder this computer does not know cannot run an Agent, so there is no catalog to ask for and
     the answer would not change until a folder is chosen. Three sources used to retrigger this read on every
     revision change, which is what turned one refusal into a storm of them (N-2 / AC-7). `none` is not in here:
     that Project runs its turns in the Chat Home and has a real catalog. */
  const folderless = workspaceBinding?.kind === "unbound";
  const loadModels = useCallback(() => {
    const workspace = modelScopeRef.current;
    /* A package Provider's model list is not served this period (settings:listModels answers unknown-provider): an empty list,
       never an error, and its options carry no model. */
    const listed = builtinAgent(backend);
    if (!listed) return Promise.resolve([] as BackendModelInfo[]);
    if (!workspace || folderless) return Promise.resolve([] as BackendModelInfo[]);
    const request = ++modelGeneration.current;
    const current = () => request === modelGeneration.current && activeModelKey.current === modelKey;
    return listModels(listed, workspace).then(result => {
      // A newer display request does not cancel the catalog awaited by this send.
      if (!current()) return result;
      setModelsOwner(modelKey); setModels(result); setModelsError(null);
      /* The composer stops being a skeleton the first time a model list lands;
         markStartup keeps only that first report. */
      markStartup("models-ready");
      reconcileRef.current(result);
      return result;
    }).catch(cause => {
      if (!current()) return;
      setModelsOwner(modelKey); setModels([]); setModelsError(rendererAgentSurfaceFailure("service-unavailable", backendLabel(listed), cause, listed));
      return [] as BackendModelInfo[];
    }).finally(() => { if (current()) setModelsLoading(false); });
  }, [backend, folderless, modelKey]);
  const retryModels = useCallback(() => { setModelsLoading(true); return loadModels(); }, [loadModels]);
  const ensureInitialModel = useCallback(async () => {
    const draft = readAgentDraft(chatId);
    const options = builtinOptions(draft.options);
    if (draft.canonical || draft.pending || !options || modelOptions === "none" || folderless || !modelScopeRef.current) return;
    const remembered = settingsStore.getSnapshot().settings?.defaultChatOptionsByBackend[options.backend]?.model;
    if (remembered || !isFactoryChatOptions(options) || explicitModelChoice.current.has(`${chatId}:${backend}`)) return;
    const catalog = modelsOwner === modelKey && !modelsLoading && models.length ? models : await loadModels();
    if (!catalog?.length) throw new Error(translate(locale, "chat.composer.modelSelector.noModels"));
    if (activeChat.current !== chatId || activeModelKey.current !== modelKey) throw new Error(translate(locale, "chat.agentSwitch.stale"));
    reconcileRef.current(catalog);
  }, [backend, chatId, folderless, loadModels, locale, modelKey, modelOptions, models, modelsLoading, modelsOwner]);
  useEffect(() => {
    if (!state.loading && modelsOwner === modelKey && !modelsLoading) reconcileRef.current(models);
  }, [state.loading, modelsOwner, modelKey, modelsLoading, models]);
  useEffect(() => {
    if (!state.initialized) return;
    void loadModels();
    const unwatch = onSetupEvent(event => {
      if (event.type === "models-invalidated" && event.backend === backend) void loadModels();
    });
    return () => { modelGeneration.current += 1; unwatch(); };
  }, [backend, loadModels, state.initialized]);
  const selectBackend = useCallback(async (backend: ChatAgentId) => {
    const intent = preferenceIntents.begin(backend);
    try {
      setSettingsError("");
      await pendingSelect(backend);
      const draft = readAgentDraft(chatId);
      if (activeChat.current === chatId && draft.options.backend === backend && !draft.loading) {
        await rememberOptions(draft.options, intent, false, undefined, true);
      }
    }
    catch (cause) {
      const reason = errorMessage(cause);
      const code = reason.startsWith("AGENT_SWITCH_BLOCKED:") ? reason.slice("AGENT_SWITCH_BLOCKED:".length) : null;
      setSettingsError(code ? translate(locale, `chat.agentSwitch.${code}`) : translate(locale, "chat.agentSwitch.selectionFailed", { message: reason }));
      throw cause;
    }
  }, [chatId, pendingSelect, locale, rememberOptions]);
  const capturePreferenceUse = useCallback((options: ChatTurnOptions) => {
    const draft = readAgentDraft(chatId).options;
    const current = builtinOptions(draft), used = builtinOptions(options);
    if (activeChat.current !== chatId || draft.backend !== options.backend || draft.model !== options.model
      || current?.reasoningEffort !== used?.reasoningEffort
      || (current && "serviceTier" in current ? current.serviceTier : undefined) !== (used && "serviceTier" in used ? used.serviceTier : undefined)) return;
    const choice = structuredClone(draft), intent = preferenceIntents.begin(draft.backend);
    return () => { void rememberOptions(choice, intent, true); };
  }, [chatId, rememberOptions]);
  const rememberUsedOptions = useCallback((options: ChatTurnOptions) => capturePreferenceUse(options)?.(), [capturePreferenceUse]);
  const readTurnOptions = useCallback(() => readAgentDraft(chatId).options, [chatId]);
  const lockBackend = useCallback(async (_backend: string) => {
    const record = await pendingRefresh();
    return record?.options ?? readAgentDraft(chatId).options;
  }, [chatId, pendingRefresh]);
  return useMemo(() => ({
    turnOptions, builtinTurnOptions, lockedBackend: state.canonical?.agent ?? null,
    agentRevision: state.canonical?.agentRevision ?? 0,
    pendingAgent: state.pending, undoAgentSwitch: pendingUndo,
    canonicalAgent: state.canonical?.agent ?? null,
    canonicalHasSession: Boolean(state.canonical?.session),
    switchReason: state.canonical?.readOnlyReason && state.canonical.readOnlyReason !== "external-readonly" ? "readonly" : state.canonical?.context.kind !== "ordinary" && state.canonical ? "app-bound" : state.canonical?.archivedAt ? "archived" : null,
    switchLocked: Boolean(state.adoption || state.canonical?.readOnlyReason && state.canonical.readOnlyReason !== "external-readonly" || state.canonical && state.canonical.context.kind !== "ordinary" || state.canonical?.archivedAt),
    backends, settingsLoading: !state.initialized || state.loading, settingsSaving: settingsSaving || Boolean(state.adoption), settingsError: settingsError || state.adoptionError || (pendingError ? translate(locale, "chat.runtime.settings.readFailed", { message: errorMessage(pendingError) }) : ""),
    /* A Project with no folder here is answered, not awaited: the empty catalog is derived rather than stored,
       so no state has to be written back when the binding changes. */
    models: folderless || modelsOwner !== modelKey ? [] : models,
    modelsLoading: Boolean(builtinTurnOptions) && !folderless && (modelsOwner !== modelKey || modelsLoading),
    modelsError: folderless || modelsOwner !== modelKey ? null : modelsError,
    /* Why the catalog is empty, said once where the person is looking for models. The row's own
       "Choose folder…" is where they act; this only answers the question the empty menu raises. */
    modelsEmpty: folderless ? translate(locale, "projects.unbound.turnRefused") : null, retryBackends, retryModels, initFailure,
    selectBackend, lockBackend, updateTurnOptions, rememberUsedOptions, capturePreferenceUse, ensureInitialModel, readTurnOptions,
  }), [turnOptions, builtinTurnOptions, state, pendingUndo, pendingError, locale, folderless, modelKey, modelsOwner, backends, settingsSaving, settingsError, models,
    modelsLoading, modelsError, retryBackends, retryModels, initFailure, selectBackend, lockBackend, updateTurnOptions, rememberUsedOptions, capturePreferenceUse, ensureInitialModel, readTurnOptions]);
}
