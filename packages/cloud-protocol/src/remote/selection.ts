/**
 * [INPUT]: Depends on Zod and structured errors after original remote operation receipt lookup.
 * [OUTPUT]: Provides closed uncommitted preparation and rate/capacity/entitlement admission rejection proofs, including the not-owner refusal.
 * [POS]: Shared remote recovery boundary for Web UI and the desktop main/preload adapter.
 */
import { z } from "zod";

// `remote/chats:retryPreparation` checks its original receipt before these guards. Auth, protocol and flag errors do not prove that absence.
export const preparationRejectionSchema = z.enum(["not-owner", "device-revoked", "device-offline", "execution-running", "remote-rate-limited"]);
export type PreparationRejection = z.infer<typeof preparationRejectionSchema>;
export function preparationRejection(error: unknown): PreparationRejection | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const result = preparationRejectionSchema.safeParse(error.data);
  return result.success ? result.data : null;
}

/* Entitlement refusals are admission rejections too: nothing was stored, so the composer keeps the input and explains why. */
export const remoteAdmissionRejectionSchema = z.enum(["remote-rate-limited", "remote-command-limit", "attachment-unavailable", "entitlement-required", "quota-exceeded"]);
export type RemoteAdmissionRejection = z.infer<typeof remoteAdmissionRejectionSchema>;
export type RemoteAdmissionRejected = { rejected: RemoteAdmissionRejection };
export function remoteAdmissionRejection(error: unknown): RemoteAdmissionRejection | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const result = remoteAdmissionRejectionSchema.safeParse(error.data);
  return result.success ? result.data : null;
}
