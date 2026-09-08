/**
 * [INPUT]: Depends on canonical ChatRecord ownership, TurnSnapshot phase/token, and TurnEntry lifecycle facts
 * [OUTPUT]: Provides resume recovery allowedActions and the blocking activity reason for Agent switching
 * [POS]: agent recovery policy boundary shared by live publication and renderer re-attach
 */

import { isOriginalAdoptedBinding } from "../../../shared/chat-agent/contracts";
import type { TurnSnapshot } from "../../../shared/agent-ipc";
import type { ChatRecord } from "../../../shared/chats-ipc";
import { blocksNewTurn, type TurnEntry } from "../turn-registry";

export function switchActivityReason(entry: TurnEntry | undefined) {
  if (!blocksNewTurn(entry) || !entry) return null;
  if ([...entry.approvals.values()].some(approval => approval.purpose === "plan-review")) return "plan-review" as const;
  if (entry.approvals.size || entry.userInputs.size) return "approval" as const;
  if (entry.effectiveTerminal || entry.phase === "resume-failed" || entry.phase === "retry-claiming") return "recovery" as const;
  return "running" as const;
}

export function projectTurnAllowedActions(
  record: Pick<ChatRecord, "importOrigin" | "agentRevision" | "session"> | null,
  snapshot: Omit<TurnSnapshot, "allowedActions"> | TurnSnapshot
): TurnSnapshot {
  const recoverable =
    snapshot.phase === "resume-failed" && Boolean(snapshot.retryToken);
  return {
    ...snapshot,
    allowedActions: {
      sameSession: recoverable,
      freshSession: recoverable && !(record && isOriginalAdoptedBinding(record)),
      abandon: recoverable,
    },
  } as TurnSnapshot;
}
