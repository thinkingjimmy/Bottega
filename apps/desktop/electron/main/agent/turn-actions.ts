/**
 * [INPUT]: Depends on canonical ChatRecord import ownership and TurnSnapshot phase/token
 * [OUTPUT]: Provides the single main-side projector for resume recovery allowedActions
 * [POS]: agent recovery policy boundary shared by live publication and renderer re-attach
 */

import type { TurnSnapshot } from "../../../shared/agent-ipc";
import type { ChatRecord } from "../../../shared/chats-ipc";

export function projectTurnAllowedActions(
  record: Pick<ChatRecord, "importOrigin"> | null,
  snapshot: Omit<TurnSnapshot, "allowedActions"> | TurnSnapshot
): TurnSnapshot {
  const recoverable =
    snapshot.phase === "resume-failed" && Boolean(snapshot.retryToken);
  return {
    ...snapshot,
    allowedActions: {
      sameSession: recoverable,
      freshSession: recoverable && !record?.importOrigin,
      abandon: recoverable,
    },
  } as TurnSnapshot;
}
