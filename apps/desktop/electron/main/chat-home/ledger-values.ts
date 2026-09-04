/**
 * [INPUT]: Depends on zod and shared Archive/Settings type
 * [OUTPUT]: Provides ChatHome/Purge durable schemas, including optional managed-worktree creation identity and immutable deletion authorization
 * [POS]: The pure schema of the chat-home module is true source, and the IO owner only consumes verified status
 */

import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const incarnationId = z.string().regex(/^[a-f0-9]{32}$/);
const absolutePath = z.string().min(1).max(4096).startsWith("/");
export const rootIdentitySchema = z
  .object({ dev: z.string().min(1), ino: z.string().min(1) })
  .strict();

export const creationPhaseSchema = z.enum([
  "planned",
  "materialized",
  "prepared",
  "committed",
  "rollingBack",
  "rolledBack",
]);

export const chatHomeRecordSchema = z
  .object({
    intentId: id,
    chatId: id,
    incarnationId,
    homeDir: absolutePath,
    canonicalRoot: absolutePath,
    rootIdentity: rootIdentitySchema,
    ownership: z.enum(["planned", "valid", "invalid"]),
    phase: creationPhaseSchema,
    submissionHash: z.string().regex(/^[a-f0-9]{64}$/),
    workspaceScope: z.unknown(),
    stagingOwner: z.string().min(1).max(128).optional(),
    worktree: z
      .object({
        kind: z.literal("managed-worktree"),
        projectId: id,
        baseCommit: z.string().regex(/^[a-f0-9]{40,64}$/),
        branch: z.string().min(1).max(240),
        relativePath: z.literal("worktree"),
      })
      .strict()
      .optional(),
    terminalAt: z.number().int().nonnegative().optional(),
  })
  .strict();

export const chatHomeLedgerSchema = z
  .object({
    version: z.literal(1),
    chats: z.record(id, chatHomeRecordSchema),
  })
  .strict();

const archiveTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat"), id }).strict(),
  z.object({ kind: z.literal("project"), id }).strict(),
]);

const purgeMemoryTargetSchema = z
  .object({
    providerId: id,
    providerDataInstanceId: id,
    hostname: z.string().min(1).max(253),
    model: z.string().min(1).max(512),
    chats: z.number().int().nonnegative(),
    turns: z.number().int().nonnegative(),
  })
  .strict();

export const purgeIntentSchema = z
  .object({
    intentId: id,
    target: archiveTargetSchema,
    targets: z.array(archiveTargetSchema).min(1),
    members: z
      .array(z.object({ chatId: id, incarnationId }).strict())
      .default([]),
    homeDeletionChatIds: z.array(id).optional(),
    deletionMode: z.enum(["local-only", "cleanup-and-rebuild"]),
    memoryTarget: purgeMemoryTargetSchema.nullable(),
    phase: z.enum([
      "planned",
      "homeMoved",
      "recordDeleted",
      "relatedDeleted",
      "projectBaseRemoved",
      "memoryRebuilt",
      "completed",
      "failed",
    ]),
    completedChatIds: z.array(id).default([]),
    trashPaths: z.array(absolutePath).default([]),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    terminalAt: z.number().int().nonnegative().optional(),
    error: z.string().max(2_000).optional(),
  })
  .strict();

export const purgeJournalSchema = z
  .object({
    version: z.literal(2),
    intents: z.record(id, purgeIntentSchema),
  })
  .strict();

export type RootIdentity = z.infer<typeof rootIdentitySchema>;
export type ChatHomeRecord = z.infer<typeof chatHomeRecordSchema>;
export type ChatHomeLedgerState = z.infer<typeof chatHomeLedgerSchema>;
export type PurgeIntent = z.infer<typeof purgeIntentSchema>;
export type PurgeJournalState = z.infer<typeof purgeJournalSchema>;

export const emptyChatHomeLedger = (): ChatHomeLedgerState => ({
  version: 1,
  chats: {},
});

export const emptyPurgeJournal = (): PurgeJournalState => ({
  version: 2,
  intents: {},
});
