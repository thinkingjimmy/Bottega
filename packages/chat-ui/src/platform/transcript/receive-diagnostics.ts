/**
 * [INPUT]: Trusted live replay and highest loaded body-row milestones (not complete history); no record identities or content.
 * [OUTPUT]: Provides beginReceive for bounded opaque observations through the shared snapshot leaf.
 * [POS]: Client-memory receive evidence only; never writes a read receipt or claims a person viewed a reply.
 */
import { receiveProgressEntries as sessions, type ReceiveProgress } from "./receive-snapshot";
type Change = { phase: ReceiveProgress["phase"]; verifiedChunkSeq?: number; installedBodySeq?: number; settlementObserved?: boolean };
const CAPACITY = 32, RETENTION_MS = 24 * 60 * 60_000;
let nextSession = 0;
function prune() {
  const oldest = Date.now() - RETENTION_MS;
  for (const [key, value] of sessions) if (value.updatedAt < oldest) sessions.delete(key);
  while (sessions.size > CAPACITY) sessions.delete(sessions.keys().next().value!);
}
export function beginReceive(kind: ReceiveProgress["kind"]) {
  const sessionId = `receive-${++nextSession}`, now = Date.now();
  sessions.set(sessionId, { sessionId, kind, phase: "waiting", startedAt: now, updatedAt: now, verifiedAt: null,
    verifiedChunkSeq: null, installedBodySeq: null, settlementObserved: false, retries: 0, retryAt: null }); prune();
  const update = (change: Change) => {
    prune(); const value = sessions.get(sessionId); if (!value) return;
    value.phase = change.phase; value.updatedAt = Date.now();
    for (const key of ["verifiedChunkSeq", "installedBodySeq"] as const) {
      const number = change[key];
      if (number !== undefined && Number.isSafeInteger(number) && number >= 0) {
        value[key] = Math.max(value[key] ?? 0, number); value.verifiedAt = value.updatedAt;
      }
    }
    if (change.settlementObserved) value.settlementObserved = true;
    if (change.phase !== "retrying") value.retryAt = null;
  };
  return { update, retry(at: number) {
    update({ phase: "retrying" }); const value = sessions.get(sessionId);
    if (value) { value.retryAt = Number.isSafeInteger(at) && at >= 0 ? at : null; value.retries = Math.min(value.retries + 1, 1_000_000); }
  }, close: () => update({ phase: "closed" }) };
}
