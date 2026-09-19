/**
 * [INPUT]: Closed encryption errors, shared five-language copy and transient React state.
 * [OUTPUT]: Typed field errors, safe error sentences and edit-aware reportFailure handling for closed error codes.
 * [POS]: Shared error presentation for password setup and unlock; operation failures survive draft edits.
 */
import { useState } from "react";
import { getCloudEncryptionCopy } from "@ai-chat/ui/lib/cloud-copy/encryption";
import { syncEncryptionErrorSchema, type SyncEncryptionError } from "../../../../shared/cloud/encryption";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export type PasswordField = "password" | "confirmation";
export type EncryptionFieldErrors = Partial<Record<PasswordField | "form", string>>;

/** A local validator throws its own code; anything else is an unusable password. */
export const passwordFailure = (error: unknown): SyncEncryptionError =>
  syncEncryptionErrorSchema.safeParse(error instanceof Error ? error.message : "").data ?? "sync-password-invalid";

export function encryptionError(error: SyncEncryptionError | null, locale: string): string | undefined {
  if (!error) return;
  const copy = getCloudEncryptionCopy(locale);
  if (error in copy) return copy[error as keyof typeof copy];
  switch (error) {
    case "sync-key-storage-unavailable": return copy.cachedStorageUnavailable;
    case "sync-key-cache-unreadable": return copy.cacheUnreadable;
    case "sync-key-save-failed": return copy.secureSaveFailedDesktop;
    case "sync-password-mismatch": return copy.passwordMismatch;
    case "legacy-sync-unsupported": return copy.legacyUnsupported;
    case "sync-review-expired": return copy.reviewExpired;
    case "sync-connection-failed": return copy.connectionFailed;
    default: return copy.unavailable;
  }
}

function errorTarget(error: SyncEncryptionError | null): keyof EncryptionFieldErrors {
  switch (error) {
    case "sync-password-invalid": case "sync-password-weak": case "sync-unlock-failed": return "password";
    case "sync-password-mismatch": return "confirmation";
    default: return "form";
  }
}

export function useEncryptionErrors(externalError: SyncEncryptionError | null) {
  const { i18n } = useAppTranslation();
  const [error, setError] = useState<SyncEncryptionError | null>(null);
  const [dismissed, setDismissed] = useState<SyncEncryptionError | null>(null);
  const errors: EncryptionFieldErrors = {};
  for (const failure of [externalError === dismissed ? null : externalError, error]) {
    if (failure) errors[errorTarget(failure)] = encryptionError(failure, i18n.language);
  }
  const editField = (field: PasswordField) => {
    const affected = (failure: SyncEncryptionError | null) => errorTarget(failure) === field ||
      (field === "password" && errorTarget(failure) === "confirmation");
    if (affected(error)) setError(null);
    if (affected(externalError)) setDismissed(externalError);
  };
  // Each attempt may fail with the same code, so editing dismisses only the previous attempt.
  const resetErrors = () => { setError(null); setDismissed(null); };
  return { errors, reportFailure: setError, editField, resetErrors };
}
