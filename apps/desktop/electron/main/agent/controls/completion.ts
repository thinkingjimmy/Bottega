/**
 * [INPUT]: Depends on frozen winning control sources and the shared bounded interaction result reducer.
 * [OUTPUT]: Enriches close events and attach snapshots with the winning device, including unattended remote decisions.
 * [POS]: Pure TurnRegistry collaborator; the coordinator ledger owns durable winning decisions.
 */
import { resolvedInteractions } from "@ai-chat/cloud-protocol/turns/interactions/reducer";
import { type InteractionSource, type InteractionResult } from "@ai-chat/cloud-protocol/turns/live";
import type { AgentEventBody } from "../../../../shared/agent-ipc";
export type InteractionState = { interactionSources?: Map<string, InteractionSource>; interactionResults?: InteractionResult[] };
export function completeInteraction(entry: InteractionState, body: AgentEventBody): AgentEventBody {
  if (body.type !== "approval-closed" && body.type !== "user-input-closed") return body;
  const kind = body.type === "approval-closed" ? "approval" : "input";
  const interactionId = body.type === "approval-closed" ? body.approvalId : body.userInputId, key = `${kind}:${interactionId}`;
  const resolvedBy = entry.interactionSources?.get(key) ?? body.resolvedBy;
  if (!resolvedBy) return body;
  entry.interactionSources?.delete(key);
  entry.interactionResults = resolvedInteractions(entry.interactionResults, { kind, interactionId, resolvedBy });
  return { ...body, resolvedBy };
}
