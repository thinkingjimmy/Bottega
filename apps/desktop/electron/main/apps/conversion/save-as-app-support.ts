/**
 * [INPUT]: Depends on the shared SessionRef limits, the single backend-id schema, and the lifecycle save-as-app phase order
 * [OUTPUT]: Provides the pure Save as App rules: allocated identity, recovery-field decoding, rollback-phase predicates, slug, rejection results, and error text
 * [POS]: The stateless half of apps/conversion/save-as-app; SaveAsAppService owns step ordering while every recovery-field decode and rollback judgement lives here
 */

import {
  SESSION_ID_BYTE_LIMIT,
  type SessionRef,
} from "../../../../shared/agent-ipc";
import { agentBackendIdSchema } from "../../../../shared/agent-schema";
import { phaseReached, type LifecycleIntent } from "../../lifecycle/intent-types";

export type SaveIdentity = {
  appId: string;
  projectId: string;
  turnIntentId: string;
  promotionRequestId: string;
};

const at = (phase: string, target: string) =>
  phaseReached("save-as-app", phase, target);

/** 已建壳但未 promote 的中途态,和一切 rollback 态,都欠一次补偿。 */
export function needsRollback(phase: string) {
  return (
    isRollbackPhase(phase) ||
    (at(phase, "record-created") && !at(phase, "promoted"))
  );
}

export function isRollbackPhase(phase: string) {
  return at(phase, "rollback-started");
}

export function allocatedIdentity(intent: LifecycleIntent): SaveIdentity {
  const fields = [
    "appId",
    "projectId",
    "turnIntentId",
    "promotionRequestId",
  ] as const;
  const result = {} as SaveIdentity;
  for (const key of fields) {
    const value = intent.allocated[key];
    if (typeof value !== "string" || !value) {
      throw new Error(`save-as-app intent 缺少 allocated.${key}`);
    }
    result[key] = value;
  }
  return result;
}

export function recoveryStringOrNull(
  intent: LifecycleIntent,
  key: string,
  fallback: string | null
) {
  if (!(key in intent.recoveryState)) return fallback;
  const value = intent.recoveryState[key];
  if (value === null || typeof value === "string") return value;
  throw new Error(`save-as-app recoveryState.${key} 无效`);
}

export function recoverySession(intent: LifecycleIntent): {
  recorded: boolean;
  value: SessionRef | null;
} {
  if (!("originalSessionRef" in intent.recoveryState)) {
    return { recorded: false, value: null };
  }
  const value = intent.recoveryState.originalSessionRef;
  if (value === null) return { recorded: true, value: null };
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    Object.hasOwn(value, "backend") &&
    Object.hasOwn(value, "id")
  ) {
    const candidate = value as { backend?: unknown; id?: unknown };
    const backend = agentBackendIdSchema.safeParse(candidate.backend);
    if (
      backend.success &&
      typeof candidate.id === "string" &&
      candidate.id.length > 0 &&
      Buffer.byteLength(candidate.id, "utf8") <= SESSION_ID_BYTE_LIMIT
    ) {
      return {
        recorded: true,
        value: { backend: backend.data, id: candidate.id },
      };
    }
  }
  throw new Error("save-as-app recoveryState.originalSessionRef 无效");
}

export function rollbackError(
  intent: LifecycleIntent,
  fallback = {
    code: "SAVE_AS_APP_ROLLED_BACK",
    message: "Save as App 已回滚",
  }
) {
  const value = intent.recoveryState.rollbackError;
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { code?: unknown }).code === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  ) {
    return value as { code: string; message: string };
  }
  return fallback;
}

export function appSlug(name: string) {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "app-protocol";
}

export function rejected(code: string, message: string) {
  return {
    status: "business-rejected" as const,
    error: { code, message },
  };
}

export const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
