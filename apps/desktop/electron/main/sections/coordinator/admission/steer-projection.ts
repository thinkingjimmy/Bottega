/**
 * [INPUT]: Depends on Steer durable intent, PreparedManualTurn Integrity/hydration and coordinator stableId
 * [OUTPUT]: Provides derived manual identity, Steer receipt and bounded projection that can be reloaded to reconstruct custody in the renderer
 * [POS]: Steer reading model of coordinator/admission; Separate durable status translation from access/side effects sorting
 */

import type {
  SteerIpcReceipt,
  SteerOutboxProjection,
} from "../../../../../shared/agent-ipc";
import { stableId } from "../coordinator-values";
import type { SteerIntent } from "../relay-ledger";
import {
  assertPreparedContentHash,
  hydratePreparedTurn,
  type PreparedManualTurn,
} from "./prepared-manual-turn";

export const steerDerivedIntentId = (outboxRef: string) =>
  stableId("manual", `steer:${outboxRef}`);

export function steerReceipt(intent: SteerIntent): SteerIpcReceipt {
  if (intent.phase === "persisted" || intent.phase === "injected") {
    return {
      outcome: "injected",
      outboxRef: intent.outboxRef,
      persistState: intent.phase === "persisted" ? "persisted" : "pending",
    };
  }
  if (intent.phase === "transferred") {
    return {
      outcome: "unconsumed",
      outboxRef: intent.outboxRef,
      reason: intent.reason ?? "已转交为下一轮",
      derivedIntentId: steerDerivedIntentId(intent.outboxRef),
    };
  }
  if (intent.phase === "dismissed") {
    return {
      outcome: "dismissed",
      outboxRef: intent.outboxRef,
      reason: intent.reason ?? "用户已删除无法确认送达的消息",
    };
  }
  if (intent.phase === "journaled" || intent.phase === "awaitingDecision") {
    return {
      outcome: "ambiguous",
      outboxRef: intent.outboxRef,
      reason: intent.reason ?? "无法确认 steering 是否已送达",
    };
  }
  return {
    outcome: "failed",
    outboxRef: intent.outboxRef,
    reason: intent.reason ?? "steering 未完成",
  };
}

const hasDurableResource = (prepared: PreparedManualTurn) =>
  prepared.input.some(
    (item) => item.type === "mention" || item.type === "skill"
  ) ||
  prepared.content.content.richValue.some((node) =>
    ["file", "skill", "workspace-file"].includes(node.type)
  );

async function recoveryProjection(
  intent: SteerIntent,
  prepared: PreparedManualTurn
): Promise<NonNullable<SteerOutboxProjection["recovery"]>> {
  const envelope = intent.envelope as { displayText: string };
  if (hasDurableResource(prepared)) {
    return {
      mode: "decision",
      displayText: envelope.displayText,
      input: [{ type: "text", text: envelope.displayText }],
    };
  }
  const hydrated = await hydratePreparedTurn(prepared);
  const persistence = hydrated.submission.persistence;
  return {
    mode: "editable",
    displayText: envelope.displayText,
    input: hydrated.submission.turn.input,
    ...(persistence.input.attachmentPayloads?.length
      ? { attachmentPayloads: persistence.input.attachmentPayloads }
      : {}),
  };
}

export async function projectSteerIntent(
  intent: SteerIntent
): Promise<SteerOutboxProjection> {
  const projection: SteerOutboxProjection = {
    outboxRef: intent.outboxRef,
    requestId: intent.requestId,
    phase: intent.phase,
    createdAt: intent.createdAt,
    ...(intent.reason ? { reason: intent.reason } : {}),
    ...(intent.phase === "transferred"
      ? { derivedIntentId: steerDerivedIntentId(intent.outboxRef) }
      : {}),
  };
  if (intent.phase !== "failed" && intent.phase !== "transferred") {
    return projection;
  }
  const prepared = intent.stagedSnapshot as PreparedManualTurn;
  assertPreparedContentHash(prepared);
  return {
    ...projection,
    recovery: await recoveryProjection(intent, prepared),
  };
}
