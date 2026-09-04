/**
 * [INPUT]: Depends on renderer error normalization and a caller-provided Base reload
 * [OUTPUT]: Provides finite mutation copy descriptors, reload-aware recovery, and BaseMutationOutcome
 * [POS]: Error policy boundary for components/bases/state; raw transport messages are fallback diagnostics, never the catalog
 */

import { errorMessage } from "@/lib/errors";

/* ── mutation intent 的对外判决 ────────────────────────────────
 * null 即成功；string 是已收进 workbench 顶部横幅的错误文案。
 * 由 workbench 的 intent() 单点生产，承诺永不伴随 rejection——
 * fire-and-forget 调用点忽略返回值天然安全，成功门读判决决定去留，
 * 就地错误 UI（formula 编辑器）显示的与横幅是同一份文案。 */
export type BaseMutationOutcome = string | null;

export type BaseMutationErrorCopy = {
  copyKey: string;
  values: Record<string, string | number>;
};

export class BaseMutationReloadError extends Error {
  readonly copy: BaseMutationErrorCopy;

  constructor(copyKey: string, values: BaseMutationErrorCopy["values"] = {}) {
    super(copyKey);
    this.name = "BaseMutationReloadError";
    this.copy = { copyKey, values };
  }
}

export function isBaseRevisionConflict(cause: unknown) {
  return mutationCode(cause) === "revision_conflict";
}

/**
 * 结构化 code → 可本地化文案。main 抛的中文裸串只作最后兜底：
 * 凡是用户能触发的领域错误，都应在这张表里有母语说法。
 */
const MUTATION_ERROR_KEYS: Record<string, string> = {
  formula_cycle: "bases.formula.error.cycle",
  revision_conflict: "bases.workbench.revisionConflict",
  IO_ERROR: "bases.record.attachmentWriteFailed",
};

/* 目录查表只是 recoverBaseMutationError 的第一步，不是一条对外能力：
   单独导出它，调用方就能拿到 copy 却跳过那次必需的回载。 */
function baseMutationErrorCopy(
  cause: unknown
): BaseMutationErrorCopy | null {
  const code = mutationCode(cause);
  const copyKey = code ? MUTATION_ERROR_KEYS[code] : undefined;
  if (!copyKey) return null;
  if (code !== "formula_cycle") return { copyKey, values: {} };
  const detail =
    cause && typeof cause === "object" && "detail" in cause
      ? (cause as { detail?: { columns?: string[] } }).detail
      : undefined;
  return { copyKey, values: { columns: (detail?.columns ?? []).join(" → ") } };
}

function mutationCode(cause: unknown) {
  if (!cause || typeof cause !== "object" || !("code" in cause)) return null;
  return typeof cause.code === "string" ? cause.code : null;
}

export async function recoverBaseMutationError(
  cause: unknown,
  reload: () => Promise<unknown>
): Promise<{ copy: BaseMutationErrorCopy } | { message: string }> {
  if (cause instanceof BaseMutationReloadError) {
    await reload().catch(() => null);
    return { copy: cause.copy };
  }
  if (isBaseRevisionConflict(cause)) {
    await reload().catch(() => null);
  }
  const copy = baseMutationErrorCopy(cause);
  return copy ? { copy } : { message: errorMessage(cause) };
}
