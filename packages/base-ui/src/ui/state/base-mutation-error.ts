/**
 * [INPUT]: Depends on renderer error normalization and a caller-provided Base reload
 * [OUTPUT]: Provides finite mutation copy descriptors, reload-aware recovery, and BaseMutationOutcome
 * [POS]: Shared Base presentation in ui/state.
 */

import { errorMessage } from "@ai-chat/ui/lib/errors";

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

const MUTATION_ERROR_KEYS: Record<string, string> = {
  formula_cycle: "bases.formula.error.cycle",
  revision_conflict: "bases.workbench.revisionConflict",
  IO_ERROR: "bases.record.attachmentWriteFailed",
};

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
