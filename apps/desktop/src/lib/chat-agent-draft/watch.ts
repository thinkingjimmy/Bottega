/**
 * [INPUT]: Depends on submission outcome queries/events, accepted native/adoption identities, and receipt-authorized draft reconciliation
 * [OUTPUT]: Watches an accepted native or adoption intent with non-overlapping queries and capped backoff until reconciliation or disposal
 * [POS]: Live recovery driver for pending Agent choices and imported first turns; it never resubmits content or creates another intent
 */
import { getSubmissionOutcome, subscribeSubmissionOutcomes } from "../sections-client";
import { readAgentDraft } from "./state";
import { reconcileAgentSubmission } from "./submission";

export function watchAgentSubmission(chatId: string, intentId: string, setError: (cause: unknown) => void) {
  let disposed = false;
  let delay = 250;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = () => !disposed && (readAgentDraft(chatId).pending?.submitting === intentId || readAgentDraft(chatId).adoption?.intentId === intentId);
  const report = (cause: unknown) => { if (active()) setError(cause); };
  const receive = async (outcome: Awaited<ReturnType<typeof getSubmissionOutcome>>) => {
    if (!active() || outcome.intentId !== intentId) return;
    setError(null);
    await reconcileAgentSubmission(chatId, outcome);
    if (!active()) clearTimeout(timer);
  };
  const unsubscribe = subscribeSubmissionOutcomes(outcome => { void receive(outcome).catch(report); });
  const poll = async () => {
    if (!active()) return;
    try { await receive(await getSubmissionOutcome(intentId)); }
    catch (cause) { report(cause); }
    if (active()) {
      timer = setTimeout(() => { void poll(); }, delay);
      delay = Math.min(delay * 2, 5_000);
    }
  };
  void poll();
  return () => { disposed = true; clearTimeout(timer); unsubscribe(); };
}
