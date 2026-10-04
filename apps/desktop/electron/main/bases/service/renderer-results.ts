/**
 * [INPUT]: Depends on the shared Bases result schemas and main error normalization.
 * [OUTPUT]: Provides snapshotResult, ensureResult, importErrorResult, mutationError and MESSAGE_CODES — the coded envelope every Bases renderer refusal travels in.
 * [POS]: Result shaping for bases-renderer-ipc; kept apart from the channel wiring so it loads without Electron.
 */
import type { BaseMutationError } from "../../../../shared/bases/model/bases-ipc";
import { baseImportMutationResultSchema, baseMutationSnapshotResultSchema } from "../../../../shared/bases/model/bases-schema";
import { errorMessage } from "../../ipc/errors";

/** ensure may wait (bounded) for the deferred startup pass, so the owner fence runs again before the snapshot leaves. */
export function ensureResult<T>(key: string, fence: (key: string) => string, ensure: (key: string) => Promise<T>) {
  return snapshotResult(async () => {
    const snapshot = await ensure(fence(key));
    fence(key);
    return snapshot;
  });
}

/**
 * 只有失败分支过 schema：错误对象是现场拼的，形状没人替它把关；
 * 判别式 union 让 parse 直接落到 ok:false 那一支，不再牵动 snapshot。
 * 成功分支不重跑 zod——commitLocked 已逐行 parse 过，再 parse 一遍既是
 * O(rows) 白工，又会把「已经提交成功的 mutation」反报成 ok:false。
 */
/* Every refusal of a snapshot call, the owner and authority checks included, travels coded in the envelope: an Electron
   rejection keeps only its message, and the renderer maps codes, never text. The success branch is not re-parsed. */
export async function snapshotResult<T>(run: () => Promise<T>) {
  try {
    return { ok: true as const, snapshot: await run() };
  } catch (cause) {
    return snapshotErrorResult(cause);
  }
}

function snapshotErrorResult(cause: unknown) {
  return baseMutationSnapshotResultSchema.parse({
    ok: false,
    error: mutationError(cause),
  });
}

export function importErrorResult(cause: unknown) {
  return baseImportMutationResultSchema.parse({
    ok: false,
    error: mutationError(cause),
  });
}

/* Refusals thrown today with their code as the message prefix. Only these are kept: any other leading uppercase text
   (from data, a Provider or the server) must never become a code the renderer branches on. */
export const MESSAGE_CODES = ["APP_SURFACE_LEASE_REVOKED", "APP_SURFACE_LEASE_INVALID", "LIBRARY_NOT_CONFIGURED",
  "BASE_OWNER_TRANSFERRED", "BASE_PROMOTION_IN_PROGRESS"] as const;

export function mutationError(cause: unknown): BaseMutationError {
  const value = cause && typeof cause === "object" ? cause : null;
  const code = value && "code" in value && typeof value.code === "string"
    ? value.code.slice(0, 128)
    : MESSAGE_CODES.find(known => new RegExp(`^${known}(:|$)`).test(errorMessage(cause))) ?? "mutation_failed";
  const currentRevision = value && "currentRevision" in value &&
      typeof value.currentRevision === "number"
    ? value.currentRevision
    : undefined;
  const issues = value && "issues" in value && Array.isArray(value.issues)
    ? value.issues
    : undefined;
  const detail = value && "detail" in value
    ? (value.detail as BaseMutationError["detail"])
    : undefined;
  return {
    code,
    message: errorMessage(cause).slice(0, 4_096) || "Base mutation 失败",
    ...(currentRevision === undefined ? {} : { currentRevision }),
    ...(issues?.length ? { issues } : {}),
    ...(detail?.columns.length ? { detail } : {}),
  };
}
