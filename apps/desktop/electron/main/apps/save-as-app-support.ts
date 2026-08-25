/**
 * [INPUT]: Depends on shared SaveAsAppInput/SessionRef, backend identity single schema and lifecycle save-as-app phase/intent contract
 * [OUTPUT]: Save as App input to phase/allocated/recovery projection, slug, rejection of results and error text pure rules
 * [POS]: The statusless rules of apps/save-as-app; The task ordering is stored in SaveAsAppService, where the recovery field analysis and judgement is focused
 */

import {
  SESSION_ID_BYTE_LIMIT,
  type SessionRef,
} from "../../../shared/agent-ipc";
import { agentBackendIdSchema } from "../../../shared/agent-schema";
import type { SaveAsAppInput } from "../../../shared/apps-ipc";
import {
  INTENT_PHASES,
  type LifecycleIntent,
} from "../lifecycle/intent-types";

export type SaveIdentity = {
  appId: string;
  projectId: string;
  turnIntentId: string;
  promotionRequestId: string;
};

const phases = INTENT_PHASES["save-as-app"] as readonly string[];

export function reached(intent: LifecycleIntent, phase: string) {
  return phases.indexOf(intent.phase) >= phases.indexOf(phase);
}

export function needsRollback(phase: string) {
  const current = phases.indexOf(phase);
  return (
    current >= phases.indexOf("rollback-started") ||
    (current >= phases.indexOf("record-created") &&
      current < phases.indexOf("promoted"))
  );
}

export function isRollbackPhase(phase: string) {
  return phases.indexOf(phase) >= phases.indexOf("rollback-started");
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

export function normalizeInput(input: SaveAsAppInput) {
  if (
    !input ||
    typeof input.chatId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.chatId) ||
    typeof input.requestId !== "string" ||
    input.requestId.length < 1
  ) {
    throw new Error("Save as App 参数无效");
  }
  const name = input.name.trim();
  const icon = input.icon.trim();
  if (!name || name.length > 120 || !icon || icon.length > 16) {
    throw new Error("Save as App 名称或图标无效");
  }
  return { ...input, name, icon };
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
