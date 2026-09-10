/**
 * [INPUT]: Depends on Zod and explicit synchronization scope identities.
 * [OUTPUT]: Provides the portable Project allowlist and its local association codec.
 * [POS]: Project identity boundary; workspace paths, capabilities and grants have no portable representation.
 */
import { z } from "zod";
import { storageIdSchema as id, storageRevisionSchema as rev, syncScopeSchema } from "../../../../../shared/local-storage/contracts";
export const portableProjectSchema = z.object({
  id, name: z.string().trim().min(1).max(100), sortIndex: rev,
  appearance: z.object({ color: z.string().max(32), icon: z.string().max(64) }).strict().optional(),
  createdAt: rev, updatedAt: rev, role: z.enum(["workspace", "base-custody"]),
  appId: z.string().regex(/^[a-z0-9]{10}$/).nullable(), cloudRevision: rev,
}).strict().refine(value => value.updatedAt >= value.createdAt && (value.role !== "base-custody" || value.appId === null));
export type PortableProject = z.infer<typeof portableProjectSchema>;
export const projectSyncAssociationSchema = z.object({
  scope: syncScopeSchema, cloudRevision: rev, operationId: id, payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
