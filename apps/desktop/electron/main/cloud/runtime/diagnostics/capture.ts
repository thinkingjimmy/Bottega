/**
 * [INPUT]: Depends on the existing sync diagnostic flag, ZodError classification, fixed capture phases and exact local guard error codes.
 * [OUTPUT]: Emits opt-in capture failure time, phase and allowlisted code without error text, stacks or identifiers.
 * [POS]: Main-only diagnostic leaf used by the recorder; never changes capture failure or retry semantics.
 */
import { ZodError } from "zod";
export type CapturePhase = "source" | "receipt" | "progress" | "buffer" | "checkpoint-read" | "checkpoint-write" | "handoff";
const codes = new Set([
  "cloud-request-superseded", "TURN_DELIVERY_UNAVAILABLE",
  "SYNC_SCOPE_UNAVAILABLE", "OUTBOX_CONTENT_CHANGED", "CHAT_SOURCE_UNAVAILABLE_OR_CHANGED", "CHAT_SOURCE_CHUNK_CHANGED",
  "CHAT_SOURCE_CHUNK_ORDER", "CHAT_SOURCE_BUDGET", "CHAT_SOURCE_CONTENT_CHANGED", "CHAT_SOURCE_NONCANONICAL",
  "CHAT_CHECKPOINT_INVALID", "CHAT_CHECKPOINT_RECEIPT_INVALID", "LIVE_CAPTURE_ALREADY_STARTED", "LIVE_CAPTURE_CHUNK_CHANGED",
  "OUTBOX_IDENTITY_MISMATCH", "OUTBOX_CHECKPOINT_BUDGET", "OUTBOX_CHECKPOINT_CHANGED", "CHECKPOINT_CHAT_MISMATCH", "TURN_CHUNK_SEQUENCE_CONFLICT",
  "LEDGER_HANDOFF_COMMAND_INVALID", "LEDGER_HANDOFF_RECEIPT_INVALID", "LEDGER_HANDOFF_IDENTITY_CONFLICT", "LEDGER_HANDOFF_CHANGED",
  "LEDGER_HANDOFF_DISPATCH_CONFLICT", "LEDGER_HANDOFF_CONTENT_CONFLICT", "LEDGER_HANDOFF_RESULT_UNAVAILABLE",
  "LEDGER_HANDOFF_PROOF_CHANGED", "LEDGER_HANDOFF_PROOF_CONFLICT",
  "LOCAL_EXECUTION_AUTHORITY_REQUIRED", "TURN_HANDOFF_IDENTITY_MISMATCH", "TURN_HANDOFF_INCOMPLETE",
]);
export function reportCaptureFailure(phase: CapturePhase, error: unknown) {
  if (process.env.BOTTEGA_SYNC_DIAGNOSTICS !== "1") return;
  try {
    const message = error instanceof Error ? error.message : null;
    const code = error instanceof ZodError ? "validation-failed"
      : message !== null && codes.has(message) ? message : "unclassified";
    console.warn("[cloud-capture-failure]", { at: Date.now(), phase, code });
  } catch { /* Diagnostics must not replace the capture failure, including when its sink is unavailable. */ }
}
