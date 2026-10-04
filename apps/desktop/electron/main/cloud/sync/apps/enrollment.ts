/**
 * [INPUT]: Depends on the original App creation operation/receipt, shared empty-Base kernel and sole BaseStore capture command.
 * [OUTPUT]: Enrolls original local App rows against their receipt-proven baseline before observing newer cloud changes.
 * [POS]: App creation handoff; it never treats the current remote Base as an empty initialization baseline.
 */
import { canonicalJson, hashBytes, initialBaseState } from "@ai-chat/cloud-protocol";
import { appOperationSchema, appReceiptSchema } from "@ai-chat/cloud-protocol/apps/model";
import { sameScope, type SyncScope } from "../../../../../shared/local-storage/contracts";
import type { AppPublication } from "../../../apps/store/portable/publication-model";
import type { BaseStore } from "../../../bases/base-store";
export async function enrollCreatedAppBase(bases: BaseStore, scope: SyncScope, plan: AppPublication) {
  if (!plan.createReceipt || !sameScope(plan.scope, scope)) throw new Error("APP_CREATION_RECEIPT_REQUIRED");
  const operation = appOperationSchema.options[0].parse(plan.operation), receipt = appReceiptSchema.parse(plan.createReceipt);
  if (receipt.kind !== "create" || !["applied", "converged"].includes(receipt.outcome) || receipt.operationId !== operation.operationId ||
    receipt.appId !== operation.appId || receipt.projectId !== operation.projectId || receipt.baseId !== operation.baseId ||
    receipt.payloadHash !== hashBytes(new TextEncoder().encode(canonicalJson(operation)))) throw new Error("APP_CREATION_RECEIPT_CHANGED");
  const { tombstones: _tombstones, ...confirmed } = initialBaseState(JSON.parse(operation.metaJson));
  if (confirmed.meta.owner.kind !== "project" || confirmed.meta.owner.projectId !== operation.projectId ||
    confirmed.meta.ownerInstanceId !== operation.baseId || confirmed.meta.navigation.kind !== "internal-app" ||
    confirmed.meta.navigation.appId !== operation.appId) throw new Error("APP_BASE_IDENTITY_CHANGED");
  const owner = `project:${operation.projectId}`, envelope = bases.sync.read(owner, operation.baseId);
  if (envelope.scope) {
    if (!sameScope(envelope.scope, scope)) throw new Error("BASE_SYNC_SCOPE_UNAVAILABLE"); return;
  }
  await bases.sync.captureInitial(owner, operation.baseId, scope, confirmed, plan.manifestId);
}
