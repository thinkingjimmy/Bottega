/**
 * [INPUT]: Depends on Zod and public cloud identity contracts.
 * [OUTPUT]: Defines first-sync review/progress, the setup boundary and retention counts for reviewed cleanup.
 * [POS]: Shared main/preload/renderer display contract; Store snapshots and local locators stay in main.
 */
import { z } from "zod";
const count = z.number().int().nonnegative().safe();
const appIssue = z.object({ appId: z.string(), name: z.string(), reason: z.enum([
  "not-published", "package-too-large", "source-unavailable", "generation-changed", "association-unavailable", "migration-blocked", "version-conflict",
]) }).strict();
export const chatInventorySchema = z.object({ nativeChats: count, messages: count, messageBytes: count,
  attachments: count, attachmentBytes: count, externalChats: count, importedEntries: count, importedBytes: count }).strict();
export const syncReviewSchema = z.object({ reviewId: z.string().uuid(), inspectedAt: count,
  native: chatInventorySchema, bases: z.object({ count, rows: count, bytes: count, images: count, imageBytes: count }).strict(),
  projects: count, homes: z.object({ count, files: count, bytes: count, omitted: count }).strict(),
  skills: z.object({ count, generations: count, files: count, bytes: count }).strict().optional(),
  apps: z.object({ count, bytes: count, blocked: z.array(appIssue).max(1000) }).strict(),
}).strict();
export const syncProgressSchema = z.object({ status: z.enum(["not-connected", "scanning", "initializing", "syncing", "synced", "partial", "paused", "offline", "error", "closing"]),
  pending: count.default(0), conflicts: count.default(0), completed: count.default(0), total: count.default(0),
  uploadedBytes: count.default(0), totalBytes: count.default(0),
  appIssues: z.array(appIssue).max(1000).default([]),
  phase: z.enum(["projects", "apps", "chats", "bases", "files", "homes"]).nullable().default(null),
  error: z.enum(["scan-failed", "review-expired", "upload-failed", "cleanup-failed"]).nullable().default(null),
}).strict();
export const syncApprovalSchema = z.object({ reviewId: z.string().uuid() }).strict();
export const syncPauseSchema = z.object({ paused: z.boolean() }).strict();
export const syncCleanupReviewSchema = z.object({ reviewId: z.string().uuid(), mirrors: count, retainedChats: count,
  retainedHomes: count, retainedBases: count, mirroredBases: count, mirroredProjects: count, retainedProjects: count,
  mirroredApps: count, retainedApps: count, pending: count }).strict();
export type SyncReview = z.infer<typeof syncReviewSchema>;
export type SyncProgress = z.infer<typeof syncProgressSchema>;
export type SyncCleanupReview = z.infer<typeof syncCleanupReviewSchema>;
export function requiresSyncSetup(progress: Pick<SyncProgress, "status">) {
  return progress.status === "not-connected" || progress.status === "scanning";
}
