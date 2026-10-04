/**
 * [INPUT]: Depends on shared Project codecs, Node hashing and explicit synchronization scope identities.
 * [OUTPUT]: Provides scoped associations, original operations/receipts and validated persistent deletion cancellation.
 * [POS]: Project identity boundary; workspace paths, capabilities and grants have no portable representation.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson, portableProjectSchema, projectOperationContent, projectOperationSchema, projectReceiptSchema } from "@ai-chat/cloud-protocol";
import { storageIdSchema as id, storageRevisionSchema as rev, syncScopeSchema } from "../../../../../shared/local-storage/contracts";
import { frozenProjectOperationSchema, verifyProjectOperation } from "@ai-chat/cloud-protocol/projects/encrypted";
export { portableProjectSchema, type PortableProject } from "@ai-chat/cloud-protocol";
export const projectSyncAssociationSchema = z.object({
  scope: syncScopeSchema, cloudRevision: rev, operationId: id, payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: portableProjectSchema.optional(), retention: z.enum(["local", "mirror"]).default("local"), deleted: z.boolean().default(false),
  pending: z.array(z.object({ operation: projectOperationSchema, predecessorId: id.nullable(),
    attempts: rev, state: z.enum(["queued", "blocked"]) }).strict()).default([]),
  conflicts: z.array(z.object({ operation: projectOperationSchema, receipt: projectReceiptSchema }).strict()).default([]),
  receipts: z.array(projectReceiptSchema).default([]),
  ciphertextBindings: z.array(frozenProjectOperationSchema).default([]),
  deletionKept: z.object({ operationId: id, payloadHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
}).strict().superRefine((sync, ctx) => {
  const known = new Set<string>();
  let valid = !sync.confirmed || sync.confirmed.cloudRevision === sync.cloudRevision;
  if (sync.deletionKept && !sync.receipts.some(item => item.operationId === sync.deletionKept!.operationId && item.payloadHash === sync.deletionKept!.payloadHash && item.status === "conflicted")) valid = false;
  for (const receipt of sync.receipts) {
    if (known.has(receipt.operationId)) valid = false;
    known.add(receipt.operationId);
  }
  for (const pending of sync.pending) {
    if (known.has(pending.operation.operationId) || pending.predecessorId && (!known.has(pending.predecessorId) || pending.attempts > 0) ||
      createHash("sha256").update(projectOperationContent(pending.operation)).digest("hex") !== pending.operation.payloadHash) valid = false;
    known.add(pending.operation.operationId);
  }
  for (const conflict of sync.conflicts) if (conflict.operation.operationId !== conflict.receipt.operationId || conflict.operation.payloadHash !== conflict.receipt.payloadHash ||
    createHash("sha256").update(projectOperationContent(conflict.operation)).digest("hex") !== conflict.operation.payloadHash ||
    !sync.receipts.some(receipt => canonicalJson(receipt) === canonicalJson(conflict.receipt))) valid = false;
  const ciphertextIds = new Set<string>();
  for (const binding of sync.ciphertextBindings) {
    const operationId = binding.transport.operationId;
    const original = sync.pending.find(item => item.operation.operationId === operationId)?.operation ?? sync.receipts.find(item => item.operationId === operationId);
    if (ciphertextIds.has(operationId) || !original || original.payloadHash !== binding.plaintextHash || original.projectId !== binding.transport.projectId) valid = false;
    ciphertextIds.add(operationId);
    try { verifyProjectOperation(binding.transport, binding.encryptedSpace.scope); } catch { valid = false; }
  }
  if (!valid) ctx.addIssue({ code: "custom", message: "Project synchronization identities are inconsistent" });
});
export type ProjectSyncAssociation = z.infer<typeof projectSyncAssociationSchema>;
export function assertPortableProjectIdentity(project: { id: string; sync?: ProjectSyncAssociation }, ctx: z.RefinementCtx) {
  const sync = project.sync;
  if (sync && (sync.confirmed && sync.confirmed.id !== project.id ||
    [...sync.pending.map(item => item.operation), ...sync.conflicts.map(item => item.operation), ...sync.receipts].some(item => item.projectId !== project.id))) {
    ctx.addIssue({ code: "custom", path: ["sync"], message: "Project synchronization owner changed" });
  }
}
