/**
 * [INPUT]: Depends on Live TurnEntry records and continuously registered request reservations.
 * [OUTPUT]: Provides pending, unfinished-turn, and next-generation retry stop-operation identities.
 * [POS]: Agent quit-authorization snapshot; terminal generations cannot authorize new retries.
 */
import type { TurnEntry } from "../../turn-registry";
import { requestOperation, type StopOperation } from "../../presence/lifecycle/start-fence";
export function snapshotStopOperations(entries: readonly TurnEntry[], reservations: readonly StopOperation[]): StopOperation[] {
  return [...entries.flatMap((entry) => [
    ...(!entry.effectiveTerminal ? [requestOperation(entry.conversationId, entry.requestId, entry.incarnationId, entry.generation)] : []),
    ...(entry.retryClaim ? [requestOperation(entry.conversationId, entry.requestId, entry.incarnationId, entry.retryClaim.generation + 1)] : []),
  ]), ...reservations];
}
