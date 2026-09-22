/**
 * [INPUT]: Depends on canonical Chat options, per-Chat Agent drafts, workspace-scoped model catalogs, Setup invalidation events, the narrow defaults command, and the startup-marks sink
 * [OUTPUT]: Provides revision-fenced options and pending Agent controls, parallel catalog/default reads, scope-fenced catalog refreshes that stand down for a Project with no folder on this computer, one-shot quiet reconciliation of a persisted model the loaded catalog no longer offers, read-only/archived save copy for bare machine codes, and the models-ready milestone
 * [POS]: Composer settings owner; canonical commit and default learning are separate operations
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentBackendId, AgentScope, AgentTurnOptions, AgentWorkspaceScope, BackendInfo, BackendModelInfo } from "../../../../shared/agent-ipc";
import { listModels, patchChatOptions, rememberChatDefaults } from "@/lib/settings-client";
import { readAgentDraft, receiveCanonicalAgent, updateAgentDraft } from "@/lib/chat-agent-draft/state";
import type { ChatRuntimeContext } from "../../../../shared/chats-ipc";
import type { ProjectWorkspaceBinding } from "../../../../shared/projects-ipc";
import { optionsForListModel } from "@ai-chat/chat-ui/models/selection";
import { turnOptionsSchema } from "../../../../shared/chat-agent/options";
import { errorMessage, failureCode } from "@ai-chat/ui/lib/errors";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { backendLabel } from "@/lib/agent-backends";
import { rendererAgentSurfaceFailure, type AgentSurfaceFailure } from "@/lib/agent-failure";
import { useEffectiveLocale } from "@/lib/i18n-locale";
import { markStartup } from "@/lib/startup-marks";
import { onSetupEvent } from "@/lib/setup-client";
import { translate } from "../../../../shared/i18n/runtime";
import { usePendingAgent } from "./agent-switch/use-pending-agent";

/* 裸机器码经 errorMessage 会被抹成空串（packages/ui/src/lib/errors.ts 的
   BARE_MACHINE_CODE），"保存失败：" 后面于是什么都没有。CHAT_NOT_WRITABLE 是
   这条路径上唯一的裸码，复用 Chat 已经在用的那两句只读/归档文案。 */
function saveFailureCopy(locale: AppLocale, cause: unknown, canonical: ChatRuntimeContext) {
  if (failureCode(cause) === "CHAT_NOT_WRITABLE") {
    return translate(locale, canonical.archivedAt ? "chat.agentSwitch.archived" : "chat.agentSwitch.readonly");
  }
  return translate(locale, "chat.runtime.settings.saveFailed", { message: errorMessage(cause) });
}

export function useChatSettings(scope: AgentScope, requestedModelScope: AgentWorkspaceScope | null,
  backends: BackendInfo[], retryBackends: () => Promise<void>, draftBackend?: AgentBackendId, workspaceScopeKey = "",
  workspaceBinding: ProjectWorkspaceBinding | null = null) {
  const chatId = scope.conversationId;
  const locale = useEffectiveLocale();
  const pending = usePendingAgent(chatId, draftBackend);
  const { state, error: pendingError, select: pendingSelect, refresh: pendingRefresh, undo: pendingUndo } = pending;
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
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [models, setModels] = useState<BackendModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<AgentSurfaceFailure | null>(null);
  const modelGeneration = useRef(0);
  const reconciledModel = useRef("");
  const activeChat = useRef(chatId);
  const activeModelKey = useRef(modelKey);
  const modelScopeRef = useRef(modelScope);
  useLayoutEffect(() => { activeChat.current = chatId; activeModelKey.current = modelKey; modelScopeRef.current = modelScope; }, [chatId, modelKey, modelScope]);
  /* `quiet` 属于对账这类没人按过按钮的写入：回滚照做，但不许冒出一条用户
     没发起过的报错。用户自己的保存永远走 quiet=false。 */
  const writeTurnOptions = useCallback(async (next: AgentTurnOptions, reset: boolean, quiet: boolean) => {
    const captured = readAgentDraft(chatId);
    if (captured.adoption || captured.pending?.submitting) throw new Error("AGENT_SWITCH_SUBMITTING");
    if (captured.options.backend !== next.backend) throw new Error("AGENT_SELECTION_REQUIRED");
    updateAgentDraft(chatId, current => ({ ...current, options: next }));
    if (!quiet) setSettingsError("");
    if (captured.pending || !captured.canonical) return;
    const canonical = captured.canonical;
    setSettingsSaving(true);
    try {
      const { backend: _backend, ...patch } = next;
      const saved = await patchChatOptions({ chatId, expectedAgent: canonical.agent,
        expectedAgentRevision: canonical.agentRevision, expectedChatRecordRevision: canonical.chatRecordRevision, patch }, reset);
      receiveCanonicalAgent(chatId, { ...canonical, ...saved });
      void rememberChatDefaults(next).catch(() => {
        if (!quiet && activeChat.current === chatId) setSettingsError(translate(locale, "chat.agentSwitch.defaultsFailed"));
      });
    } catch (cause) {
      updateAgentDraft(chatId, current => current.generation === captured.generation ? { ...current, options: captured.options } : current);
      if (quiet) console.debug("[chat:options] quiet write rejected", failureCode(cause) || errorMessage(cause));
      else if (activeChat.current === chatId) setSettingsError(saveFailureCopy(locale, cause, canonical));
      throw cause;
    } finally {
      if (activeChat.current === chatId) setSettingsSaving(false);
    }
  }, [chatId, locale]);
  const updateTurnOptions = useCallback((next: AgentTurnOptions, reset = false) =>
    writeTurnOptions(next, reset, false), [writeTurnOptions]);
  /* ── 目录里没有的模型必须当场换掉 ───────────────────────────────
     账号默认模型被 CLI 淘汰后（见 backends/codex/models.ts 排除的占位项），
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
    const options = draft.options;
    const slug = "model" in options ? options.model : undefined;
    if (!slug || options.backend !== backend) return;
    if (catalog.some(entry => entry.slug === slug)) return;
    const canonical = draft.canonical;
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
    const next = turnOptionsSchema.safeParse(optionsForListModel(options, target));
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
    if (!workspace || folderless) return Promise.resolve();
    const request = ++modelGeneration.current;
    const current = () => request === modelGeneration.current && activeModelKey.current === modelKey;
    return listModels(backend, workspace).then(result => {
      if (!current()) return;
      setModelsOwner(modelKey); setModels(result); setModelsError(null);
      /* The composer stops being a skeleton the first time a model list lands;
         markStartup keeps only that first report. */
      markStartup("models-ready");
      reconcileRef.current(result);
    }).catch(cause => {
      if (!current()) return;
      setModelsOwner(modelKey); setModels([]); setModelsError(rendererAgentSurfaceFailure("service-unavailable", backendLabel(backend), cause, backend));
    }).finally(() => { if (current()) setModelsLoading(false); });
  }, [backend, folderless, modelKey]);
  const retryModels = useCallback(() => { setModelsLoading(true); return loadModels(); }, [loadModels]);
  useEffect(() => {
    if (!state.initialized) return;
    void loadModels();
    const unwatch = onSetupEvent(event => {
      if (event.type === "models-invalidated" && event.backend === backend) void loadModels();
    });
    return () => { modelGeneration.current += 1; unwatch(); };
  }, [backend, loadModels, state.initialized]);
  const selectBackend = useCallback(async (backend: AgentBackendId) => {
    try { setSettingsError(""); await pendingSelect(backend); }
    catch (cause) {
      const reason = errorMessage(cause);
      const code = reason.startsWith("AGENT_SWITCH_BLOCKED:") ? reason.slice("AGENT_SWITCH_BLOCKED:".length) : null;
      setSettingsError(code ? translate(locale, `chat.agentSwitch.${code}`) : translate(locale, "chat.agentSwitch.selectionFailed", { message: reason }));
      throw cause;
    }
  }, [pendingSelect, locale]);
  const lockBackend = useCallback(async (_backend: AgentBackendId) => {
    const record = await pendingRefresh();
    return record?.options ?? readAgentDraft(chatId).options;
  }, [chatId, pendingRefresh]);
  return useMemo(() => ({
    turnOptions, lockedBackend: state.canonical?.agent ?? null,
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
    modelsLoading: !folderless && (modelsOwner !== modelKey || modelsLoading),
    modelsError: folderless || modelsOwner !== modelKey ? null : modelsError,
    /* Why the catalog is empty, said once where the person is looking for models. The row's own
       "Choose folder…" is where they act; this only answers the question the empty menu raises. */
    modelsEmpty: folderless ? translate(locale, "projects.unbound.turnRefused") : null, retryBackends, retryModels,
    selectBackend, lockBackend, updateTurnOptions,
  }), [turnOptions, state, pendingUndo, pendingError, locale, folderless, modelKey, modelsOwner, backends, settingsSaving, settingsError, models,
    modelsLoading, modelsError, retryBackends, retryModels, selectBackend, lockBackend, updateTurnOptions]);
}
