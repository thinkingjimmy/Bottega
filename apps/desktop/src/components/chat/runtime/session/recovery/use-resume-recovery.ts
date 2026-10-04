/**
 * [INPUT]: Depends on canonical turn projections with one-based attempt generations, Agent retry/cancel ports, React external-store subscriptions, pending-Agent admission guards, the locale provider, and chat-ui's recoveryFailure classifier
 * [OUTPUT]: Provides useResumeRecovery with independent dialog visibility, durable-failure discovery, token-scoped action locks, and a request-scoped failure line (never the raw error) that survives the turn re-arming under a new token
 * [POS]: Presentation and action owner for resume recovery beneath useChatSession; dismissing never changes main-owned turn state
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { abandonResumeFailure, retryAgentSameSession, retryAgentWithoutSession } from "@/lib/agent/agent-client";
import { readAgentDraft } from "@/lib/chat-agent-draft/state";
import type { ChatProjectionStatus } from "@/lib/chat/session/chat-turn-attach";
import { recoveryFailure, type RecoveryFailure } from "@ai-chat/chat-ui/interactions/model";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";

type ResumeAction = "sameSession" | "freshSession" | "abandon";
/* Keyed by request: a failed action can re-arm the turn under a new retry token before it returns, and its error must
   still show. Dismissal and locks belong to one token; a new token starts them over. */
type Presentation = { token: string; dismissed: boolean; pending: ResumeAction | null; claimed: ResumeAction | null; error: RecoveryFailure | "agentSwitch" | "" };
const empty: Presentation = { token: "", dismissed: false, pending: null, claimed: null, error: "" };
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
  const { t } = useAppTranslation();
  const key = JSON.stringify([chatId, resumeFailure?.requestId]);
  const token = resumeFailure?.retryToken ?? "";
  const snapshot = useCallback(() => read(key), [key]);
  const stored = useSyncExternalStore(subscribe, snapshot, snapshot);
  const state = stored.token === token ? stored : { ...empty, error: stored.error };
  const setResumeFailureOpen = useCallback((open: boolean) =>
    update(key, { ...(read(key).token === token ? {} : { ...empty, error: read(key).error }), token, dismissed: !open }), [key, token]);
  const run = useCallback(async (action: ResumeAction) => {
    const current = read(key);
    if (!resumeFailure?.allowedActions[action] || current.token === token && (current.pending || current.claimed)) return;
    const fresh = { ...empty, dismissed: current.token === token && current.dismissed, token };
    // A pending Agent switch already has its own line; it must not fall through to the generic failure.
    if (action !== "abandon" && readAgentDraft(chatId).pending) { update(key, { ...fresh, error: "agentSwitch" }); return; }
    update(key, { ...fresh, pending: action });
    try {
      await ports[action](resumeFailure.requestId, resumeFailure.retryToken);
      // Main's next projection retires this token. Until then, no second action may claim it.
      update(key, { pending: null, claimed: action });
    } catch (cause) {
      console.warn("[resume-recovery] action failed", cause);
      update(key, { pending: null, error: recoveryFailure(cause) });
    }
  }, [chatId, key, ports, resumeFailure, token]);
  const retrySameSession = useCallback(() => run("sameSession"), [run]);
  const retryWithoutSession = useCallback(() => run("freshSession"), [run]);
  const abandonResumeFailure = useCallback(() => run("abandon"), [run]);

  return {
    resumeFailure,
    resumeFailureOpen: Boolean(resumeFailure) && !state.dismissed,
    resumeFailurePending: resumeFailure ? state.pending ?? state.claimed : null,
    resumeFailureError: !resumeFailure || !state.error ? ""
      : state.error === "agentSwitch" ? t("chat.agentSwitch.adjacent") : t(`chat.resumeFailure.failed.${state.error}`),
    setResumeFailureOpen,
    retrySameSession,
    retryWithoutSession,
    abandonResumeFailure,
  };
}
