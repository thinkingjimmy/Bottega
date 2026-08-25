/**
 * [INPUT]: Depends on node: A stable abstract of crypto with structured cloning
 * [OUTPUT]: Provides Memory Space, freezes admission, Recall Projection, the closed set type of outcome/receipt in rounds and the only derivative function; General handoff/validation Shared Agent contracts
 * [POS]: The main/memory domain algebra; Policy, Delivery, Bridge and the renderer DTO are only consumed here, and cannot copy status priorities
 */

import { createHash } from "node:crypto";
import type {
  MemoryFailureKind,
  MemoryTurnOutcome,
} from "../../../../shared/memory-ipc";
import type {
  PromptHandoff,
  SensitiveContributionValidation,
} from "../../../../shared/agent-ipc";
import type { MemorySharingMode } from "../../../../shared/settings-ipc";

export type {
  MemoryFailureKind,
  MemorySkipReason,
  MemoryTurnOutcome,
  TurnContextReceipt,
} from "../../../../shared/memory-ipc";

export type MemorySpaceRef =
  | Readonly<{
      kind: "chat";
      chatId: string;
      incarnationId: string;
      sharingGeneration: number;
    }>
  | Readonly<{
      kind: "project";
      projectId: string;
      generation: number;
      sharingGeneration: number;
    }>
  | Readonly<{
      kind: "standalone";
      scopeOwnerId: string;
      sharingGeneration: number;
    }>
  | Readonly<{
      kind: "personal";
      scopeOwnerId: string;
      sharingGeneration: number;
    }>;

export type MemoryScopeSubject =
  | Readonly<{ kind: "chat"; chatId: string; incarnationId: string }>
  | Readonly<{ kind: "project"; projectId: string }>
  | Readonly<{ kind: "standalone"; scopeOwnerId: string }>
  | Readonly<{ kind: "personal"; scopeOwnerId: string }>;

export type FrozenTurnMemoryContext = Readonly<{
  requestId: string;
  memorySpace: MemorySpaceRef;
  memorySpaceId: string;
  sourceSessionKey: string;
  workspaceRealpath: string;
  policyRevision: number;
  consentEpochId: string;
  providerDataInstanceId: string;
  expectedPeerId: string;
  revocationRevision: number;
  runtimeGeneration: number;
  sharingMode: MemorySharingMode;
  sharingGeneration: number;
}>;

export type FrozenTurnMemoryAdmission =
  | Readonly<{ kind: "eligible"; context: FrozenTurnMemoryContext }>
  | Readonly<{
      kind: "skipped";
      requestId: string;
      reason: "disabled" | "paused" | "plan-mode";
    }>
  | Readonly<{
      kind: "unavailable";
      requestId: string;
      failureKind: MemoryFailureKind;
      /** 准入时刻冻结的观测桶；settled 禁止回读后来作用域。 */
      observationScope?: import("../../../../shared/memory-ipc").MemoryObservationScope;
    }>;

declare const memoryProjectionProof: unique symbol;
export type OpaqueMemoryProjectionProof = Readonly<{
  [memoryProjectionProof]: true;
}>;

export type MemoryRecallPrepared =
  | Readonly<{ kind: "content"; count: number }>
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "unavailable"; failureKind: MemoryFailureKind }>
  | Readonly<{ kind: "skipped"; reason: "paused" }>;

export type MemoryRecallProjection = Readonly<{
  requestId: string;
  promptText: string;
  prepared: MemoryRecallPrepared;
  proof?: OpaqueMemoryProjectionProof;
  candidateRefs: ReadonlyArray<
    Readonly<{ sourceRef: string; digest: string }>
  >;
}>;

export type MemoryPrePromptValidation = SensitiveContributionValidation;
export type { PromptHandoff } from "../../../../shared/agent-ipc";

export type MemoryTurnFacts = Readonly<{
  origin: "manual" | "other";
  frozenAdmission: FrozenTurnMemoryAdmission | null;
  prepared: MemoryRecallPrepared | null;
  prePromptValidation: MemoryPrePromptValidation;
  promptHandoff: PromptHandoff;
  assistantMessagePresent: boolean;
}>;

export function memorySpaceId(space: MemorySpaceRef) {
  if (space.kind === "chat") {
    return `memory:v2:chat:${space.chatId}:${space.incarnationId}:${space.sharingGeneration}`;
  }
  if (space.kind === "project") {
    return `memory:v2:project:${space.projectId}:${space.generation}:${space.sharingGeneration}`;
  }
  return `memory:v2:${space.kind}:${space.scopeOwnerId}:${space.sharingGeneration}`;
}

export function expectedPeerId(memorySpaceIdValue: string) {
  return createHash("sha256")
    .update(`memory-space\0${memorySpaceIdValue}`)
    .digest("hex");
}

export function sourceSessionKey(input: {
  chatId: string;
  incarnationId: string;
}) {
  return `${input.chatId}:${input.incarnationId}`;
}

/** Memory capability 进入 AgentContext 前必须递归冻结，避免 nested 值被改写。 */
export function freezeMemoryValue<T>(value: T): Readonly<T> {
  const clone = structuredClone(value);
  const freeze = (entry: unknown): void => {
    if (!entry || typeof entry !== "object" || Object.isFrozen(entry)) return;
    for (const child of Object.values(entry)) freeze(child);
    Object.freeze(entry);
  };
  freeze(clone);
  return clone;
}

/**
 * §9.5 唯一真相函数。调用点只提交已经冻结的本轮事实；禁止回读当前 Settings。
 */
export function deriveMemoryTurnOutcome(
  facts: MemoryTurnFacts
): MemoryTurnOutcome | null {
  if (facts.origin !== "manual" || !facts.assistantMessagePresent) return null;
  const admission = facts.frozenAdmission;
  if (!admission) {
    return { kind: "unavailable", failureKind: "initialization" };
  }
  if (admission.kind === "skipped") {
    return { kind: "skipped", reason: admission.reason };
  }
  if (admission.kind === "unavailable") {
    return { kind: "unavailable", failureKind: admission.failureKind };
  }
  const prepared = facts.prepared;
  if (!prepared) {
    return { kind: "unavailable", failureKind: "initialization" };
  }
  if (prepared.kind === "skipped") {
    return { kind: "skipped", reason: prepared.reason };
  }
  if (prepared.kind === "unavailable") return prepared;
  if (facts.prePromptValidation.kind === "skipped") {
    return { kind: "skipped", reason: facts.prePromptValidation.reason };
  }
  if (facts.prePromptValidation.kind === "unavailable") {
    return {
      kind: "unavailable",
      failureKind: facts.prePromptValidation.failureKind,
    };
  }
  if (facts.prePromptValidation.kind !== "allowed") {
    return { kind: "skipped", reason: "prompt-not-issued" };
  }
  if (facts.promptHandoff.kind !== "accepted") {
    return { kind: "skipped", reason: "prompt-not-issued" };
  }
  return prepared.kind === "content"
    ? { kind: "used", count: prepared.count }
    : { kind: "none" };
}

/** capture/backfill/preview 共用的「可入记忆的 assistant」唯一判定。 */
export function isMemorableAssistant(
  message: import("../../../../shared/chats-ipc").ChatMessage
) {
  return (
    message.role === "assistant" &&
    !message.isError &&
    message.kind !== "plan" &&
    message.content.trim().length > 0
  );
}
