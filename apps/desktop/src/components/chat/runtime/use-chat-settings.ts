/**
 * [INPUT]: Depends on canonical Chat options, per-Chat Agent drafts, model catalogs, and the narrow defaults command
 * [OUTPUT]: Provides pure Chat/default reads, revision-fenced option patches, and memory-only pending controls
 * [POS]: Composer settings owner; canonical commit and default learning are separate operations
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentBackendId, AgentScope, AgentTurnOptions, AgentWorkspaceScope, BackendInfo, BackendModelInfo } from "../../../../shared/agent-ipc";
import { listModels, patchChatOptions, rememberChatDefaults } from "@/lib/settings-client";
import { readAgentDraft, receiveCanonicalAgent, updateAgentDraft } from "@/lib/chat-agent-draft/state";
import { errorMessage } from "@/lib/errors";
import { backendLabel } from "@/lib/agent-backends";
import { rendererAgentSurfaceFailure, type AgentSurfaceFailure } from "@/lib/agent-failure";
import { useEffectiveLocale } from "@/lib/i18n-locale";
import { translate } from "../../../../shared/i18n/runtime";
import { usePendingAgent } from "./agent-switch/use-pending-agent";

export function useChatSettings(scope: AgentScope, modelScope: AgentWorkspaceScope | null,
  backends: BackendInfo[], retryBackends: () => Promise<void>, draftBackend?: AgentBackendId) {
  const chatId = scope.conversationId;
  const locale = useEffectiveLocale();
  const pending = usePendingAgent(chatId, draftBackend);
  const { state, error: pendingError, select: pendingSelect, refresh: pendingRefresh, undo: pendingUndo } = pending;
  const modelKey = `${chatId}:${state.options.backend}:${state.generation}`;
  const [modelsOwner, setModelsOwner] = useState("");
  const turnOptions = state.options;
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [models, setModels] = useState<BackendModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<AgentSurfaceFailure | null>(null);
  const modelGeneration = useRef(0);
  const activeChat = useRef(chatId);
  useLayoutEffect(() => { activeChat.current = chatId; }, [chatId]);
  const loadModels = useCallback(() => {
    if (!modelScope) return Promise.resolve();
    const request = ++modelGeneration.current;
    const backend = turnOptions.backend;
    const generation = readAgentDraft(chatId).generation;
    const current = () => request === modelGeneration.current && activeChat.current === chatId && readAgentDraft(chatId).generation === generation;
    return listModels(backend, modelScope).then(result => {
      if (!current()) return;
      setModelsOwner(modelKey); setModels(result); setModelsError(null);
    }).catch(cause => {
      if (!current()) return;
      setModelsOwner(modelKey); setModelsError(rendererAgentSurfaceFailure("service-unavailable", backendLabel(backend), cause, backend));
    }).finally(() => { if (current()) setModelsLoading(false); });
  }, [chatId, modelKey, modelScope, turnOptions.backend]);
  const retryModels = useCallback(() => { setModelsLoading(true); return loadModels(); }, [loadModels]);
  useEffect(() => {
    if (!state.initialized || state.loading) return;
    void loadModels();
    return () => { modelGeneration.current += 1; };
  }, [loadModels, state.initialized, state.loading]);
  const updateTurnOptions = useCallback(async (next: AgentTurnOptions, reset = false) => {
    const captured = readAgentDraft(chatId);
    if (captured.pending?.submitting) throw new Error("AGENT_SWITCH_SUBMITTING");
    if (captured.options.backend !== next.backend) throw new Error("AGENT_SELECTION_REQUIRED");
    updateAgentDraft(chatId, current => ({ ...current, options: next }));
    setSettingsError("");
    if (captured.pending || !captured.canonical) return;
    const canonical = captured.canonical;
    setSettingsSaving(true);
    try {
      const { backend: _backend, ...patch } = next;
      const saved = await patchChatOptions({ chatId, expectedAgent: canonical.agent,
        expectedAgentRevision: canonical.agentRevision, expectedChatRecordRevision: canonical.chatRecordRevision, patch }, reset);
      receiveCanonicalAgent(chatId, { ...canonical, ...saved });
      void rememberChatDefaults(next).catch(() => {
        if (activeChat.current === chatId) setSettingsError(translate(locale, "chat.agentSwitch.defaultsFailed"));
      });
    } catch (cause) {
      updateAgentDraft(chatId, current => current.generation === captured.generation ? { ...current, options: captured.options } : current);
      if (activeChat.current === chatId) setSettingsError(translate(locale, "chat.runtime.settings.saveFailed", { message: errorMessage(cause) }));
      throw cause;
    } finally {
      if (activeChat.current === chatId) setSettingsSaving(false);
    }
  }, [chatId, locale]);
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
    switchReason: state.canonical?.readOnlyReason ? "readonly" : state.canonical?.context.kind !== "ordinary" && state.canonical ? "app-bound" : state.canonical?.archivedAt ? "archived" : null,
    canonicalOptions: state.canonical?.options ?? null,
    switchLocked: Boolean(state.canonical?.readOnlyReason || state.canonical && state.canonical.context.kind !== "ordinary" || state.canonical?.archivedAt),
    backends, settingsLoading: !state.initialized || state.loading, settingsSaving, settingsError: settingsError || (pendingError ? translate(locale, "chat.runtime.settings.readFailed", { message: errorMessage(pendingError) }) : ""),
    models: modelsOwner === modelKey ? models : [], modelsLoading: modelsOwner !== modelKey || modelsLoading, modelsError: modelsOwner === modelKey ? modelsError : null, retryBackends, retryModels,
    selectBackend, lockBackend, updateTurnOptions,
  }), [turnOptions, state, pendingUndo, pendingError, locale, modelKey, modelsOwner, backends, settingsSaving, settingsError, models,
    modelsLoading, modelsError, retryBackends, retryModels, selectBackend, lockBackend, updateTurnOptions]);
}
