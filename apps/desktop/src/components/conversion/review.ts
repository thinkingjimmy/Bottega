/**
 * [INPUT]: Depends on React and bounded account/conversion preload contracts.
 * [OUTPUT]: Provides scoped conversion review with original attempts and stale response rejection.
 * [POS]: Shared desktop conversion hook; stable desktop has no cloud bridge or client requirement.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CloudConversionBridge } from "../../../shared/cloud/conversion/model";
declare global { interface Window { cloudConversion?: CloudConversionBridge } }
export function useScopedConversionReview<T>(chatId: string, read: (input: { expectedUserId: string; chatId: string }) => Promise<T | null>, receive: (review: T | null) => void) {
  const [review, setReview] = useState<T | null>(null);
  const [checking, setChecking] = useState(Boolean(window.cloudConversion));
  const [failed, setFailed] = useState(false), [userId, setUserId] = useState<string | null>(null), requests = useRef({ sequence: 0 });
  const load = useCallback(async () => {
    const sequence = ++requests.current.sequence;
    try {
      const account = await window.cloud?.getAccountState(), userId = account?.profile?.userId ?? null;
      const next = account && userId && window.cloudConversion && ["ready", "temporarily-offline"].includes(account.status) ?
        await read({ expectedUserId: userId, chatId }) : null;
      return { sequence, userId, review: next, failed: false };
    } catch { return { sequence, userId: null, review: null, failed: true }; }
  }, [chatId, read]);
  const accept = useCallback((result: Awaited<ReturnType<typeof load>>) => {
    if (result.sequence !== requests.current.sequence) return null;
    setChecking(false); setFailed(result.failed);
    if (!result.failed) { setUserId(result.userId); setReview(result.review); receive(result.review); }
    return result.failed ? null : result.review;
  }, [receive]);
  const refresh = useCallback(async () => { setChecking(true); return accept(await load()); }, [accept, load]);
  useEffect(() => {
    const state = requests.current;
    void load().then(accept);
    const unsubscribe = window.cloud?.onAccountChanged(() => { void refresh(); });
    return () => { state.sequence++; unsubscribe?.(); };
  }, [load, accept, refresh]);
  return { review, checking, failed, refresh, userId };
}
