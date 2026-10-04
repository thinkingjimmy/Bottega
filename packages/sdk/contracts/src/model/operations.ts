/**
 * [INPUT]: Depends on Zod and the strict request-digest format.
 * [OUTPUT]: Provides the operation-receipt/v1 projection (three-state admission, nine projected states, native state and evidence) and mergeOperationReceipt for monotonic updates with late-event handling.
 * [POS]: Public adaptation layer over native ledgers; it never changes what a native enum means and never infers admission from silence or time.
 */
import { z } from "zod";

export const OPERATION_RECEIPT_SCHEMA = "bottega.operation-receipt/v1" as const;
export const OPERATION_STATES = ["pending", "accepted", "running", "succeeded", "cancelled", "failed", "outcome-unknown", "expired", "rejected"] as const;
export type OperationState = (typeof OPERATION_STATES)[number];
export const OPERATION_FAMILIES = ["lifecycle-intent", "chat-operation", "turn-submission", "base-tool-batch", "remote-command", "cloud-receipt", "workflow"] as const;
export type OperationFamily = (typeof OPERATION_FAMILIES)[number];
/** Terminal states: nothing later may change them. `outcome-unknown` is deliberately absent — late reports resolve it. */
export const TERMINAL_OPERATION_STATES: ReadonlySet<OperationState> = new Set(["succeeded", "cancelled", "failed", "expired", "rejected"]);

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const ref = z.string().min(1).max(256);
const opaque = z.string().min(1).max(128);
export const operationAdmissionSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unknown") }).strict(),
  z.object({ state: z.literal("not-admitted"), proofRef: ref }).strict(),
  z.object({ state: z.literal("admitted"), intentId: opaque, requestId: opaque, submissionHash: digest }).strict(),
]);
export type OperationAdmission = z.infer<typeof operationAdmissionSchema>;

export const operationReceiptSchema = z.object({
  schema: z.literal(OPERATION_RECEIPT_SCHEMA),
  family: z.enum(OPERATION_FAMILIES),
  operationId: opaque,
  requestDigest: digest.nullable(),
  nativeReceiptRef: ref,
  nativeState: z.string().min(1).max(64),
  state: z.enum(OPERATION_STATES),
  receiptRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  admission: operationAdmissionSchema,
  resultRef: ref.nullable(),
  error: z.object({ code: z.string().min(1).max(128), message: z.string().max(1024).optional() }).strict().nullable(),
  /** `cancelled` records that cancellation was accepted; only an owner that saw the process converge may say `confirmed`. */
  stop: z.enum(["not-applicable", "unconfirmed", "confirmed"]),
  /** A wrapper (for example app.call) finishing is not the inner business effect finishing. */
  innerEffect: z.enum(["not-applicable", "unverified", "verified"]),
  resolvedBy: z.string().min(1).max(120).nullable(),
}).strict().superRefine((value, context) => {
  const admission = value.admission.state;
  if ((value.state === "rejected" || value.state === "expired") && admission !== "not-admitted") {
    context.addIssue({ code: "custom", message: "no-admission-proof-required" });
  }
  if (["accepted", "running", "succeeded", "failed"].includes(value.state) && admission !== "admitted") {
    context.addIssue({ code: "custom", message: "admission-required" });
  }
  if (admission === "not-admitted" && !["pending", "rejected", "expired", "cancelled"].includes(value.state)) {
    context.addIssue({ code: "custom", message: "not-admitted-cannot-run" });
  }
  if (value.stop !== "not-applicable" && value.state !== "cancelled") context.addIssue({ code: "custom", message: "stop-only-for-cancelled" });
});
export type OperationReceipt = z.infer<typeof operationReceiptSchema>;

export const sha256Ref = (hex: string): `sha256:${string}` => {
  if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error("operation-digest-invalid");
  return `sha256:${hex}`;
};

/* ============================================================
 * Monotonic merge. Late events after a terminal state are kept
 * as evidence of lateness but never reopen or change a result;
 * admission can be learned but never forgotten.
 * ============================================================ */
export type MergedOperationReceipt = { receipt: OperationReceipt; late: boolean };

export function mergeOperationReceipt(previous: OperationReceipt | null, next: OperationReceipt): MergedOperationReceipt {
  const incoming = operationReceiptSchema.parse(next);
  if (!previous) return { receipt: incoming, late: false };
  if (previous.operationId !== incoming.operationId || previous.family !== incoming.family) throw new Error("operation-identity-changed");
  if (previous.requestDigest && incoming.requestDigest && previous.requestDigest !== incoming.requestDigest) throw new Error("operation-digest-changed");
  if (previous.admission.state === "admitted") {
    if (incoming.admission.state !== "admitted" || incoming.admission.submissionHash !== previous.admission.submissionHash ||
      incoming.admission.intentId !== previous.admission.intentId) throw new Error("operation-admission-conflict");
  }
  if (previous.admission.state === "not-admitted" && incoming.admission.state === "admitted") throw new Error("operation-admission-conflict");
  if (TERMINAL_OPERATION_STATES.has(previous.state)) {
    const same = previous.state === incoming.state && previous.resultRef === incoming.resultRef;
    if (!same || incoming.receiptRevision <= previous.receiptRevision) return { receipt: previous, late: !same };
    /* The only facts a terminal receipt may still learn: the process converged, the inner effect was checked. */
    return { receipt: { ...previous, receiptRevision: incoming.receiptRevision,
      stop: previous.stop === "confirmed" ? "confirmed" : incoming.stop,
      innerEffect: previous.innerEffect === "verified" ? "verified" : incoming.innerEffect }, late: false };
  }
  /* A producer cannot report a terminal state "before" a live one, so terminal wins even if its revision counter
     restarted (settled tombstones keep no timestamp); among live states the higher revision wins. */
  if (TERMINAL_OPERATION_STATES.has(incoming.state)) return { receipt: incoming, late: false };
  if (incoming.receiptRevision < previous.receiptRevision) return { receipt: previous, late: true };
  return { receipt: incoming, late: false };
}
