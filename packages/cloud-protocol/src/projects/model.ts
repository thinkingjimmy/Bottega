/**
 * [INPUT]: Depends on Zod, public identities and canonical JSON hashing.
 * [OUTPUT]: Provides portable Project facts, closed metadata/deletion operations and immutable receipts.
 * [POS]: Shared Project synchronization contract; local paths, bindings and grants cannot be encoded.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../auth";
import { canonicalJson } from "../encryption/encoding";
import { versionSchema as rev } from "../scalars";
export const projectAppearanceSchema = z.object({ color: z.string().max(32), icon: z.string().max(64) }).strict();
export const projectMetadataSchema = z.object({ name: z.string().trim().min(1).max(100), sortIndex: rev,
  gitRemote: z.string().min(1).max(2048).optional(), appearance: projectAppearanceSchema.optional(), archivedAt: rev.optional() }).strict();
export const portableProjectSchema = projectMetadataSchema.extend({ id, createdAt: rev, updatedAt: rev,
  role: z.enum(["workspace", "base-custody"]), sourceDeviceId: id.optional(), appId: z.string().regex(/^[a-z0-9]{10}$/).nullable(), cloudRevision: rev,
}).strict().refine(value => value.updatedAt >= value.createdAt && (value.role !== "base-custody" || value.appId === null));
export type PortableProject = z.infer<typeof portableProjectSchema>;
const projectMetadataPatchSchema = z.object({ name: projectMetadataSchema.shape.name.optional(), sortIndex: rev.optional(),
  appearance: projectAppearanceSchema.nullable().optional(), archivedAt: rev.nullable().optional(),
  gitRemote: projectMetadataSchema.shape.gitRemote.unwrap().nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, "An empty Project patch is not an operation");
export type ProjectMetadataPatch = z.infer<typeof projectMetadataPatchSchema>;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const projectOperationSchema = z.object({ operationId: id, projectId: id, payloadHash: hash,
  command: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("create"), metadata: projectMetadataSchema, createdAt: rev }).strict(),
    z.object({ kind: z.literal("patch"), expectedRevision: rev, changes: projectMetadataPatchSchema }).strict(),
    z.object({ kind: z.literal("delete"), expectedRevision: rev }).strict(),
  ]),
}).strict();
export type ProjectOperation = z.infer<typeof projectOperationSchema>;
export const projectReceiptSchema = z.object({ operationId: id, projectId: id, payloadHash: hash,
  status: z.enum(["applied", "converged", "conflicted", "deleted"]), project: portableProjectSchema.nullable(),
  sourceDeviceId: id, createdAt: rev,
}).strict().refine(value => (value.status === "deleted") === (value.project === null));
export type ProjectReceipt = z.infer<typeof projectReceiptSchema>;
export function projectOperationContent(operation: ProjectOperation) {
  const { payloadHash: _hash, ...payload } = projectOperationSchema.parse(operation);
  return canonicalJson(payload);
}
export async function hashProjectOperation(operation: ProjectOperation) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(projectOperationContent(operation)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
