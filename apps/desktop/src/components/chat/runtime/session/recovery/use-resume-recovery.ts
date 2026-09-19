/**
 * [INPUT]: Depends on canonical turn projections with one-based attempt generations, Agent retry/cancel ports, React external-store subscriptions, and pending-Agent admission guards
 * [OUTPUT]: Provides useResumeRecovery with independent dialog visibility, durable-failure discovery, and request-scoped recovery action state across remounts
 * [POS]: Presentation and action owner for resume recovery beneath useChatSession; dismissing never changes main-owned turn state
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { abandonResumeFailure, retryAgentSameSession, retryAgentWithoutSession } from "@/lib/agent-client";
import { assertNoPendingAgent } from "@/lib/chat-agent-draft/submission";
import type { ChatProjectionStatus } from "@/lib/chat-turn-attach";
import { errorMessage } from "@ai-chat/ui/lib/errors";

type ResumeAction = "sameSession" | "freshSession" | "abandon";
type Presentation = { dismissed: boolean; pending: ResumeAction | null; claimed: ResumeAction | null; error: string };
const empty: Presentation = { dismissed: false, pending: null, claimed: null, error: "" };
const presentations = new Map<string, Presentation>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const read = (key: string) => presentations.get(key) ?? empty;
const update = (key: string, patch: Partial<Presentation>) => {
  presentations.set(key, { ...read(key), ...patch });
  // Keep navigation memory bounded without evicting an in-flight action lock.
  if (presentations.size > 64) {
    for (const [candidate, state] of presentations) {
      if (candidate !== key && !state.pending) presentations.delete(candidate);
      if (presentations.size <= 64) break;
    }
  }
  listeners.forEach((listener) => listener());
};

const defaultPorts = {
  sameSession: retryAgentSameSession,
  freshSession: retryAgentWithoutSession,
  abandon: abandonResumeFailure,
};

export function useResumeRecovery(
  chatId: string,
  projection: ChatProjectionStatus,
  ports = defaultPorts
) {
  const resumeFailure = useMemo(() =>
    projection.phase === "resume-failed" && projection.requestId && projection.retryToken
      ? {
          requestId: projection.requestId,
          retryToken: projection.retryToken,
          retried: (projection.generation ?? 1) > 1,
          allowedActions: projection.allowedActions ?? { sameSession: false, freshSession: false, abandon: false },
        }
      : null,
    [projection.phase, projection.requestId, projection.retryToken, projection.generation, projection.allowedActions]
  );
  const key = JSON.stringify([chatId, resumeFailure?.requestId, resumeFailure?.retryToken]);
  const snapshot = useCallback(() => read(key), [key]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const setResumeFailureOpen = useCallback((open: boolean) => update(key, { dismissed: !open }), [key]);
  const run = useCallback(async (action: ResumeAction) => {
    if (!resumeFailure?.allowedActions[action] || read(key).pending || read(key).claimed) return;
    update(key, { pending: action, error: "" });
    try {
      if (action !== "abandon") assertNoPendingAgent(chatId);
      await ports[action](resumeFailure.requestId, resumeFailure.retryToken);
      // Main's next projection retires this token. Until then, no second action may claim it.
      update(key, { pending: null, claimed: action });
    } catch (cause) {
      update(key, { pending: null, error: errorMessage(cause) });
    }
  }, [chatId, key, ports, resumeFailure]);
  const retrySameSession = useCallback(() => run("sameSession"), [run]);
  const retryWithoutSession = useCallback(() => run("freshSession"), [run]);
  const abandonResumeFailure = useCallback(() => run("abandon"), [run]);

  return {
    resumeFailure,
    resumeFailureOpen: Boolean(resumeFailure) && !state.dismissed,
    resumeFailurePending: resumeFailure ? state.pending ?? state.claimed : null,
    resumeFailureError: resumeFailure ? state.error : "",
    setResumeFailureOpen,
    retrySameSession,
    retryWithoutSession,
    abandonResumeFailure,
  };
}
