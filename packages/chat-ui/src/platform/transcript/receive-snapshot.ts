/**
 * [INPUT]: Bounded receive observations from the lazily loaded live/transcript owners.
 * [OUTPUT]: Provides receiveProgressSnapshot without loading readers or fetching code while offline.
 * [POS]: Tiny client-memory diagnostic leaf; contains only opaque local sessions and allowlisted progress.
 */
export type ReceiveProgress = { sessionId: string; kind: "live" | "body";
  phase: "waiting" | "replaying" | "verified" | "settlement-observed" | "reading-body" | "body-installed" | "retrying" | "failed" | "closed";
  startedAt: number; updatedAt: number; verifiedAt: number | null; verifiedChunkSeq: number | null; installedBodySeq: number | null;
  settlementObserved: boolean; retries: number; retryAt: number | null };
export const receiveProgressEntries = new Map<string, ReceiveProgress>();
export function receiveProgressSnapshot() {
  const capturedAt = Date.now();
  for (const [key, value] of receiveProgressEntries) if (capturedAt - value.updatedAt > 86_400_000) receiveProgressEntries.delete(key);
  return { coverage: "client-receive-only" as const, capturedAt, capacity: 32, retentionMs: 86_400_000,
    sessions: [...receiveProgressEntries.values()].slice(-32).map(value => ({ ...value })) };
}
