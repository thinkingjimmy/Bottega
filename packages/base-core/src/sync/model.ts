/**
 * [INPUT]: Depends on Zod and serializable Base identities and display values.
 * [OUTPUT]: Defines bounded source-aware synchronization status, candidate comparisons and explicit decision/copy/navigation ports.
 * [POS]: Shared presentation contract; hosts retain operation bodies, persistence and execution authority.
 */
import { z } from "zod";
const id = z.string().min(1).max(192), hash = z.string().regex(/^[a-f0-9]{64}$/), count = z.number().int().nonnegative();
export const baseSyncIdentitySchema = z.object({ ownerKey: z.string().min(1).max(256), baseId: id }).strict();
export type BaseSyncIdentity = z.infer<typeof baseSyncIdentitySchema>;
export const baseCandidateSummarySchema = z.object({ operationId: id, payloadHash: hash, fieldCount: count,
  actor: z.enum(["user", "agent", "system"]), waiting: z.boolean(), blocked: z.enum(["dependency", "tombstone", "app-structure"]).nullable(),
  canRestore: z.boolean(), canCopy: z.boolean().optional(), copyName: z.string().max(100).optional(), copyRequested: z.boolean().optional(), copiedTo: baseSyncIdentitySchema.optional(),
  sourceDeviceId: id.nullable(), sourceDeviceName: z.string().min(1).max(40).nullable().optional(), createdAt: count.nullable() }).strict();
export type BaseCandidateSummary = z.infer<typeof baseCandidateSummarySchema>;
export const baseSyncReviewSchema = z.object({ baseId: id, state: z.enum(["pending", "synced", "conflicted", "deleted", "moving"]),
  pending: count, conflicts: count, connected: z.boolean(), paused: z.boolean(),
  complete: z.boolean().optional(),
  items: z.array(baseCandidateSummarySchema).max(10), cursor: id.nullable() }).strict();
export type BaseSyncReview = z.infer<typeof baseSyncReviewSchema>;
const display = z.object({ text: z.string().max(1024), truncated: z.boolean() }).strict();
export const baseCandidateDetailSchema = z.object({ candidate: baseCandidateSummarySchema,
  fields: z.array(z.object({ index: count, label: z.string().max(256), rowId: id.nullable(),
    original: display, current: display, proposed: display }).strict()).max(20),
  offset: count, nextOffset: count.nullable() }).strict();
export type BaseCandidateDetail = z.infer<typeof baseCandidateDetailSchema>;
export type BaseCandidateDecision = BaseSyncIdentity & { operationId: string; payloadHash: string; action: "restore" | "discard" };
export interface BaseSyncPresentation {
  scopeKey: string;
  review(input: BaseSyncIdentity & { afterId: string | null }, signal: AbortSignal): Promise<BaseSyncReview | null>;
  detail(input: BaseSyncIdentity & { operationId: string; offset: number }, signal: AbortSignal): Promise<BaseCandidateDetail>;
  decide(input: BaseCandidateDecision): Promise<void>;
  copy?(input: BaseSyncIdentity & { operationId: string; payloadHash: string; name: string }): Promise<BaseSyncIdentity>;
  openCopy?(identity: BaseSyncIdentity): void;
  subscribe(changed: () => void): () => void;
}
