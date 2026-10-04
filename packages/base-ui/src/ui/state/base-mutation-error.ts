/**
 * [INPUT]: Depends on shared IPC failure-code extraction and a caller-provided Base reload
 * [OUTPUT]: Provides BaseUiError (the renderer's own coded refusals), describeBaseFailure (one catalog line per meaning for a failed open, change or history read; the reload a line promises happens first; anything unknown gets its context's fallback and is logged, never shown), BaseMutationReloadError, isBaseRevisionConflict, isLeaseRefusal and BaseMutationOutcome
 * [POS]: Shared Base presentation in ui/state: the only place a Base error becomes copy.
 */

import { failureCode as ipcFailureCode } from "@ai-chat/ui/lib/errors";

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

/** A refusal the workbench raises itself: a view that changed under a retried edit, the column or view limit, or a caller bug. */
export class BaseUiError extends Error {
  constructor(readonly code: "view_changed" | "column_limit" | "view_limit" | "invariant", message: string) {
    super(message);
    this.name = "BaseUiError";
  }
}

export type BaseFailureContext = "open" | "change" | "history" | "list";

const FALLBACK: Record<BaseFailureContext, string> = {
  open: "bases.failure.openFailed",
  change: "bases.failure.changeFailed",
  history: "bases.failure.historyFailed",
  list: "bases.provider.loadFailed",
};

/* Codes only, never text: main sends every Base refusal coded (bases/service/renderer-results.ts), and the workbench's
   own refusals are BaseUiError. A code missing here is a new failure that deserves its own line, so it is logged. */
const CODE_KEYS: Record<string, string> = {
  APP_SURFACE_LEASE_REVOKED: "bases.gui.leaseRefusedHint",
  APP_SURFACE_LEASE_INVALID: "bases.gui.leaseRefusedHint",
  APP_STUDIO_GRANT_CONFLICT: "bases.gui.permissionFailedHint",
  BASE_GUI_PARTIAL_DECISION: "bases.gui.permissionFailedHint",
  APP_GUI_DRAIN_TIMEOUT: "bases.gui.cutoverFailedHint",
  GUI_CUTOVER_READY_TIMEOUT: "bases.gui.cutoverFailedHint",
  APP_LIFECYCLE_ADMISSION_CLOSED: "bases.gui.cutoverFailedHint",
  APP_INCARNATION_STALE: "bases.gui.surfaceGoneHint",
  APP_DATA_MIGRATION_FAILED: "bases.gui.prepareFailedHint",
  revision_conflict: "bases.workbench.revisionConflict",
  view_changed: "bases.workbench.revisionConflict",
  unknown_column: "bases.workbench.revisionConflict",
  column_workflow_only: "bases.record.workflowOnly",
  formula_cycle: "bases.formula.error.cycle",
  formula_invalid: "bases.formula.error.syntax",
  formula_unknown_reference: "bases.formula.error.ref",
  formula_result_type_drift: "bases.formula.error.type",
  invalid_rows: "bases.cell.invalidValue",
  invalid_cell_value: "bases.cell.invalidValue",
  invalid_date: "bases.cell.invalidValue",
  invalid_relation_id: "bases.cell.invalidValue",
  relation_target_missing: "bases.cell.invalidValue",
  row_not_found: "bases.record.unavailable",
  record_missing: "bases.record.unavailable",
  IO_ERROR: "bases.record.attachmentWriteFailed",
  base_not_found: "bases.failure.gone",
  base_instance_changed: "bases.failure.moved",
  BASE_OWNER_TRANSFERRED: "bases.failure.moved",
  BASE_PROMOTION_IN_PROGRESS: "bases.failure.moving",
  base_recovery_required: "bases.failure.recover",
  base_loading: "bases.failure.loading",
  base_limit: "bases.failure.limit",
  base_capacity: "bases.failure.limit",
  column_limit: "bases.failure.limit",
  view_limit: "bases.workbench.viewLimit",
  base_closing: "bases.failure.closing",
  LIBRARY_NOT_CONFIGURED: "bases.failure.noFolder",
  "startup-recovery-pending": "bases.failure.startupPending",
  "earlier-process-holding": "bases.failure.earlierProcess",
  ENOSPC: "bases.failure.disk",
  EACCES: "bases.failure.disk",
  EPERM: "bases.failure.disk",
  EROFS: "bases.failure.disk",
  EIO: "bases.failure.disk",
  // The record dialog's own refusals: image staging, record commit, and the checks it makes before saving.
  image_upload_limit: "bases.record.uploadQueueFull",
  image_invalid: "bases.record.imageVerificationFailed",
  image_transfer_conflict: "bases.record.imageVerificationFailed",
  image_transfer_missing: "bases.record.imageVerificationFailed",
  "file-source-changed": "bases.record.imageVerificationFailed",
  "file-not-ready": "bases.record.imageVerificationFailed",
  image_transfer_io: "bases.record.fileReadFailed",
  file_read_failed: "bases.record.fileReadFailed",
  image_transfer_unavailable: "bases.record.attachmentWriteFailed",
  base_scope_changed: "bases.record.unavailable",
  record_conflict: "bases.record.recordChanged",
  schema_conflict: "bases.record.recordChanged",
  invalid_record: "bases.cell.invalidValue",
  record_save_failed: "bases.record.checkSave",
  "conflict-review-required": "bases.record.checkSave",
  "attachment-format": "bases.record.unsupportedImage",
  "attachment-dimensions": "bases.record.unsupportedImage",
  unsupported_image: "bases.record.unsupportedImage",
  "attachment-size": "bases.record.fileLimit",
  attachment_required: "bases.record.attachmentRequired",
  multiple_images: "bases.record.multipleImagesUnavailable",
};

/** A refusal known only by its code, for the renderer's own throws outside BaseUiError. */
export const codedFailure = (code: string) => Object.assign(new Error(code), { code });

/** The lines that say "the latest version was reloaded", and are true only once it has been. */
const RELOADS = new Set(["revision_conflict", "unknown_column"]);

const LEASE_CODES = new Set(["APP_SURFACE_LEASE_REVOKED", "APP_SURFACE_LEASE_INVALID"]);

/* A refused row write arrives as invalid_rows; its reason lives in the issues. Workflow-only and unknown-column are the
   reasons with their own sentence, so they are promoted to the codes the table knows. */
function failureCode(cause: unknown) {
  if (!cause || typeof cause !== "object" || !("code" in cause) || typeof cause.code !== "string") return ipcFailureCode(cause) || null;
  const issues = "issues" in cause && Array.isArray(cause.issues) ? cause.issues as { reason?: unknown }[] : [];
  if (cause.code !== "invalid_rows") return cause.code;
  if (issues.some(issue => issue?.reason === "column_workflow_only")) return "column_workflow_only";
  if (issues.some(issue => issue?.reason === "unknown_column")) return "unknown_column";
  return cause.code;
}

export const isBaseRevisionConflict = (cause: unknown) => failureCode(cause) === "revision_conflict";

/** An App surface lease that main no longer honours: the App tab re-acquires it once and retries. */
export const isLeaseRefusal = (cause: unknown) => LEASE_CODES.has(failureCode(cause) ?? "");

export async function describeBaseFailure(
  cause: unknown,
  context: BaseFailureContext,
  reload: () => Promise<unknown>
): Promise<BaseMutationErrorCopy> {
  // Already described once (a workbench write rethrown to its own surface): the same line, no second reload or log.
  const described = (cause as { baseCopy?: BaseMutationErrorCopy } | null)?.baseCopy;
  if (described) return described;
  if (cause instanceof BaseMutationReloadError) {
    await reload().catch(() => null);
    return cause.copy;
  }
  const code = failureCode(cause);
  if (code && RELOADS.has(code)) await reload().catch(() => null);
  const copyKey = code ? CODE_KEYS[code] : undefined;
  if (!copyKey) {
    console.warn(`[base] ${context} failed`, cause);
    return { copyKey: FALLBACK[context], values: {} };
  }
  if (code !== "formula_cycle") return { copyKey, values: {} };
  const detail = (cause as { detail?: { columns?: string[] } }).detail;
  return { copyKey, values: { columns: (detail?.columns ?? []).join(" → ") } };
}
