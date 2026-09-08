/**
 * [INPUT]: Depends on React subscriptions, canonical Chat reads, backend defaults, the Agent draft store, and live submission watching
 * [OUTPUT]: Provides per-Chat selection, one-time draft defaults, navigation-safe refresh, and continuing reconciliation of the original pending submission
 * [POS]: Agent draft lifecycle hook used by Chat settings; selection never persists Chat or global options
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AgentBackendId } from "../../../../../shared/agent-ipc";
import { watchAgentSubmission } from "@/lib/chat-agent-draft/watch";
import { readComposer } from "@/lib/chat-composer-store";
import { getBackendDefaults } from "@/lib/settings-client";
import { beginAgentSelection, readAgentDraft, receiveCanonicalAgent, subscribeAgentDraft,
  undoAgentSelection, updateAgentDraft } from "@/lib/chat-agent-draft/state";

export function usePendingAgent(chatId: string, draftBackend?: AgentBackendId) {
  const requests = useRef(0);
  const [error, setError] = useState<unknown>(null);
  const state = useSyncExternalStore(subscribeAgentDraft, () => readAgentDraft(chatId));
  const refresh = useCallback(async () => {
    const record = await window.chats!.runtimeContext(chatId);
    receiveCanonicalAgent(chatId, record);
    return record;
  }, [chatId]);
  useEffect(() => {
    let disposed = false;
    const generation = readAgentDraft(chatId).generation;
    void refresh().then(async record => {
      if (record || disposed || readAgentDraft(chatId).initialized || readAgentDraft(chatId).generation !== generation) return;
      const options = await getBackendDefaults(draftBackend);
      if (!disposed) updateAgentDraft(chatId, current => current.generation === generation && !current.initialized && !current.canonical
        ? { ...current, options, initialized: true } : current);
    }).catch(setError);
    const unwatch = window.chats!.onEvent(event => {
      if (event.type === "upserted" && event.summary.id === chatId) void refresh().catch(setError);
    });
    return () => { disposed = true; unwatch(); };
  }, [chatId, draftBackend, refresh]);
  useEffect(() => {
    const intentId = state.pending?.submitting;
    if (!intentId) return;
    return watchAgentSubmission(chatId, intentId, setError);
  }, [chatId, state.pending?.submitting]);
  const select = useCallback(async (backend: AgentBackendId) => {
    const request = ++requests.current;
    const generationBefore = readAgentDraft(chatId).generation;
    const current = readAgentDraft(chatId);
    if (current.canonical) {
      const queue = readComposer(chatId).queue;
      if (queue.paused || queue.items.length > 0) throw new Error("AGENT_SWITCH_BLOCKED:queue");
      const eligibility = await window.sections!.agentSwitchEligibility(chatId);
      if (requests.current !== request || readAgentDraft(chatId).generation !== generationBefore) return;
      if (!eligibility.eligible) throw new Error(`AGENT_SWITCH_BLOCKED:${eligibility.reason}`);
    }
    const generation = beginAgentSelection(chatId, backend);
    if (!readAgentDraft(chatId).loading) return;
    try {
      const options = await getBackendDefaults(backend);
      updateAgentDraft(chatId, current => current.generation === generation
        ? { ...current, options, loading: false } : current);
    } catch (cause) {
      updateAgentDraft(chatId, current => current.generation === generation ? { ...current, loading: false } : current);
      throw cause;
    }
  }, [chatId]);
  return { state, error, refresh, select, undo: useCallback(() => { requests.current++; undoAgentSelection(chatId); }, [chatId]) };
}
