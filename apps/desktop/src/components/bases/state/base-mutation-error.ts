/**
 * [INPUT]: Depends on renderer Unified errorMessage and Base Full reload
 * [OUTPUT]: Provides BaseMutationReloadError, isBaseRevisionConflict, isbaseMutationErrorCopy, recoversBaseMutationError and BaseMutationOutcome; CAS/Local Structural Drifting Both Forced Re-loading and Maintenance
 * [POS]: The mutation conflict of bases/states is closedOnly consume IPC error code, Workbench/replacement cannot copy conflict branches
 */

import { errorMessage } from "@/lib/errors";

/* ── mutation intent 的对外判决 ────────────────────────────────
 * null 即成功；string 是已收进 workbench 顶部横幅的错误文案。
 * 由 workbench 的 intent() 单点生产，承诺永不伴随 rejection——
 * fire-and-forget 调用点忽略返回值天然安全，成功门读判决决定去留，
 * 就地错误 UI（formula 编辑器）显示的与横幅是同一份文案。 */
export type BaseMutationOutcome = string | null;

export class BaseMutationReloadError extends Error {}

export function isBaseRevisionConflict(cause: unknown) {
  return mutationCode(cause) === "revision_conflict";
}

/**
 * 结构化 code → 可本地化文案。main 抛的中文裸串只作最后兜底：
 * 凡是用户能触发的领域错误，都应在这张表里有母语说法。
 */
const MUTATION_ERROR_KEYS: Record<string, string> = {
  formula_cycle: "bases.formula.error.cycle",
};

export type BaseMutationErrorCopy = {
  key: string;
  values: Record<string, string>;
};

export function baseMutationErrorCopy(
  cause: unknown
): BaseMutationErrorCopy | null {
  const code = mutationCode(cause);
  const key = code ? MUTATION_ERROR_KEYS[code] : undefined;
  if (!key) return null;
  const detail =
    cause && typeof cause === "object" && "detail" in cause
      ? (cause as { detail?: { columns?: string[] } }).detail
      : undefined;
  return { key, values: { columns: (detail?.columns ?? []).join(" → ") } };
}

function mutationCode(cause: unknown) {
  if (!cause || typeof cause !== "object" || !("code" in cause)) return null;
  return typeof cause.code === "string" ? cause.code : null;
}

export async function recoverBaseMutationError(
  cause: unknown,
  reload: () => Promise<unknown>
) {
  if (
    !(cause instanceof BaseMutationReloadError) &&
    !isBaseRevisionConflict(cause)
  ) {
    return errorMessage(cause);
  }
  await reload().catch(() => null);
  return `Base changed elsewhere. Latest state was reloaded: ${errorMessage(cause)}`;
}
