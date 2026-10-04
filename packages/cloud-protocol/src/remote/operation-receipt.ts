/**
 * [INPUT]: Depends on the remote command receipt model and the public operation-receipt/v1 contract.
 * [OUTPUT]: Provides projectRemoteReceipt, the twelve remote command states adapted onto the public operation receipt.
 * [POS]: Private adapter from the remote ledger into the public contract; it lives here because the public contracts never depend on the private remote graph.
 */
import { OPERATION_RECEIPT_SCHEMA, operationReceiptSchema, sha256Ref, type OperationAdmission, type OperationReceipt, type OperationState } from "@bottega/contracts/model/operations";
import type { RemoteCommandReceipt } from "./model";

/* ============================================================
 * Remote command mapping (02 §4). The twelve remote states are
 * adapted, not renamed: nativeState keeps the original value.
 * ============================================================ */
const REMOTE_PROJECTION: Readonly<Record<RemoteCommandReceipt["state"], OperationState>> = {
  "awaiting-preparation": "pending", delivered: "pending", pending: "pending", claimed: "pending",
  accepted: "accepted", running: "running", done: "succeeded", error: "failed", cancelled: "cancelled",
  "outcome-unknown": "outcome-unknown", expired: "expired", rejected: "rejected",
};

export function projectRemoteReceipt(receipt: RemoteCommandReceipt, options: { requestDigest?: string | null; wrapsInnerEffect?: boolean } = {}): OperationReceipt {
  const native = receipt.state;
  const state = REMOTE_PROJECTION[native];
  if (!state) throw new Error("remote-state-unknown");
  const commandId = receipt.command.commandId;
  let admission: OperationAdmission;
  if (receipt.admission) {
    if (native === "rejected" || native === "expired") throw new Error("remote-admission-contradiction");
    admission = { state: "admitted", intentId: receipt.admission.intentId, requestId: receipt.admission.requestId,
      submissionHash: sha256Ref(receipt.admission.submissionHash) };
  } else if (native === "rejected" || native === "expired") {
    /* The backend refuses a rejected/expired report once an admission exists and never hands a rejected
       command to an owner for execution, so a stored rejected/expired receipt is itself the zero-dispatch proof. */
    admission = { state: "not-admitted", proofRef: `remote-receipt:${commandId}:${native}` };
  } else {
    /* claimed, pending, outcome-unknown and cancelled-before-report carry no proof either way: silence is not refusal. */
    admission = { state: "unknown" };
  }
  if (["accepted", "running", "done", "error"].includes(native) && admission.state !== "admitted") throw new Error("remote-admission-missing");
  return operationReceiptSchema.parse({
    schema: OPERATION_RECEIPT_SCHEMA, family: "remote-command", operationId: commandId,
    requestDigest: options.requestDigest ?? null, nativeReceiptRef: `remote/commands:${commandId}`, nativeState: native, state,
    receiptRevision: Math.max(1, receipt.updatedAt), admission,
    resultRef: native === "done" || native === "error" ? `remote/commands:${commandId}:result` : null,
    error: native === "error" || native === "rejected" || native === "expired" || native === "outcome-unknown"
      ? { code: receipt.reason ?? native } : null,
    stop: state === "cancelled" ? "unconfirmed" : "not-applicable",
    innerEffect: options.wrapsInnerEffect ? state === "succeeded" ? "unverified" : "not-applicable" : "not-applicable",
    resolvedBy: receipt.result === "already-resolved" ? receipt.resolvedBy?.sourceDeviceName ?? "unknown" : null,
  });
}

