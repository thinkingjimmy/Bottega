/**
 * [INPUT]: Depends on Zod and structured errors after original remote operation receipt lookup.
 * [OUTPUT]: Provides closed uncommitted selection/preparation and rate/capacity admission rejection proofs.
 * [POS]: Shared remote recovery boundary for Web UI and the desktop main/preload adapter.
 */
import { z } from "zod";

// Both mutations check the original receipt before these guards. Auth, protocol and flag errors do not prove that absence.
export const executorSelectionRejectionSchema = z.enum(["executor-changed", "device-revoked", "device-offline", "executor-running", "remote-rate-limited"]);
export type ExecutorSelectionRejection = z.infer<typeof executorSelectionRejectionSchema>;
export function executorSelectionRejection(error: unknown): ExecutorSelectionRejection | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const result = executorSelectionRejectionSchema.safeParse(error.data);
  return result.success ? result.data : null;
}

export const remoteAdmissionRejectionSchema = z.enum(["remote-rate-limited", "remote-command-limit", "attachment-unavailable"]);
export type RemoteAdmissionRejection = z.infer<typeof remoteAdmissionRejectionSchema>;
export type RemoteAdmissionRejected = { rejected: RemoteAdmissionRejection };
export function remoteAdmissionRejection(error: unknown): RemoteAdmissionRejection | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const result = remoteAdmissionRejectionSchema.safeParse(error.data);
  return result.success ? result.data : null;
}
