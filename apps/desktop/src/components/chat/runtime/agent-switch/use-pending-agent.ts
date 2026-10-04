/**
 * [INPUT]: Depends on React subscriptions, canonical Chat reads, backend defaults, the Agent draft store, and live submission watching
 * [OUTPUT]: Provides per-Chat selection (a package Provider's fixed options come from the shared defaults, never a read main would refuse), local cancellation by reselecting the canonical Agent, one-time defaults (a failed initialization is exposed as initFailure with a retry) and navigation-safe submission reconciliation
 * [POS]: Agent draft lifecycle hook used by Chat settings; selection never persists Chat or global options
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AgentBackendId } from "../../../../../shared/ipc/agent/agent-ipc";
import { backendDefaults, builtinAgent, type ChatAgentId, type ChatTurnOptions } from "../../../../../shared/chat-agent/options";
import { watchAgentSubmission } from "@/lib/chat-agent-draft/watch";
import { readComposer } from "@/lib/chat/state/composer/chat-composer-store";
import { getBackendDefaults } from "@/lib/settings/client/settings-client";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { beginAgentSelection, readAgentDraft, receiveCanonicalAgent, subscribeAgentDraft,
  undoAgentSelection, updateAgentDraft } from "@/lib/chat-agent-draft/state";

/* A new draft starts on the default Agent only when it can run now (TASK-11 S4 follow-up); otherwise on the first Provider in the
   person's order that can, which the selector then shows. A package Provider Setup has not reported never gets a draft that sends to it. */
async function startingOptions(startOn?: (id: ChatAgentId) => ChatAgentId): Promise<ChatTurnOptions> {
  const defaults = await getBackendDefaults();
  const start = startOn ? startOn(defaults.backend) : defaults.backend;
  if (start === defaults.backend) return defaults;
  const builtin = builtinAgent(start);
  return builtin ? getBackendDefaults(builtin) : backendDefaults({}, start);
}

export function usePendingAgent(chatId: string, draftBackend?: AgentBackendId, startOn?: (id: ChatAgentId) => ChatAgentId) {
  const requests = useRef(0);
  const startOnRef = useRef(startOn);
  useLayoutEffect(() => { startOnRef.current = startOn; }, [startOn]);
  const [error, setError] = useState<unknown>(null);
  /* The draft's initialization gates the composer; its failure is shown there with a retry, never only in the model menu. */
  const [initFailure, setInitFailure] = useState<{ chatId: string; attempt: number; cause: unknown } | null>(null), [initAttempt, setInitAttempt] = useState(0);
  const state = useSyncExternalStore(subscribeAgentDraft, () => readAgentDraft(chatId));
  const refresh = useCallback(async () => {
    const record = await window.chats!.runtimeContext(chatId);
    receiveCanonicalAgent(chatId, record);
    return record;
  }, [chatId]);
  useEffect(() => {
    let disposed = false;
    /* `initialized` alone protects a selection made meanwhile; a generation check here left a draft whose entry was
       recreated during the read uninitialized for good, and its composer locked (C3). */
    void refresh().then(async record => {
      if (record || disposed || readAgentDraft(chatId).initialized) return;
      const options = draftBackend ? await getBackendDefaults(draftBackend) : await startingOptions(startOnRef.current);
      if (!disposed) updateAgentDraft(chatId, current => !current.initialized && !current.canonical
        ? { ...current, options, initialized: true } : current);
    }).catch(cause => { if (!disposed) { setError(cause); setInitFailure({ chatId, attempt: initAttempt, cause }); } });
    const unwatch = window.chats!.onEvent(event => {
      if (event.type === "upserted" && event.summary.id === chatId) void refresh().catch(setError);
    });
    return () => { disposed = true; unwatch(); };
  }, [chatId, draftBackend, refresh, initAttempt]);
  useEffect(() => {
    const intentId = state.adoption?.intentId ?? state.pending?.submitting;
    if (!intentId || state.adoption && !state.adoption.intentId) return;
    return watchAgentSubmission(chatId, intentId, setError);
  }, [chatId, state.adoption, state.pending?.submitting]);
  const select = useCallback(async (backend: ChatAgentId) => {
    const request = ++requests.current;
    const generationBefore = readAgentDraft(chatId).generation;
    const current = readAgentDraft(chatId);
    if (current.pending && !current.pending.submitting && !current.adoption && current.canonical?.agent === backend) {
      undoAgentSelection(chatId);
      return;
    }
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
      /* A package Provider's options are fixed (S3-b): nothing to learn from main, and main would refuse the read. */
      const builtin = builtinAgent(backend);
      const options = builtin ? await getBackendDefaults(builtin) : backendDefaults({}, backend);
      updateAgentDraft(chatId, current => current.generation === generation
        ? { ...current, options, loading: false } : current);
    } catch (cause) {
      updateAgentDraft(chatId, current => current.generation === generation ? { ...current, loading: false } : current);
      throw cause;
    }
  }, [chatId]);
  const initFailureView = initFailure?.chatId === chatId && initFailure.attempt === initAttempt ? { message: errorMessage(initFailure.cause), retry: () => setInitAttempt(value => value + 1) } : null;
  return { state, error, initFailure: initFailureView, refresh, select, undo: useCallback(() => { requests.current++; undoAgentSelection(chatId); }, [chatId]) };
}
