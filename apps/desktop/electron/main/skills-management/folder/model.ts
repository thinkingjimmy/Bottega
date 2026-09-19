/**
 * [INPUT]: Depends on Zod and the internal Skill acquisition contract.
 * [OUTPUT]: Provides local Skill records, slug-grammar identity, private conversion notices and atomic synchronization receipts separately from portable content.
 * [POS]: Shared validation for the sole Skill store and folder adapter.
 */
import { z } from "zod";
import { skillSlugSchema } from "@ai-chat/cloud-protocol/skills/identity";
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const provenanceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local-folder"), sourcePath: z.string().min(1), sourceIdentity: z.string().min(1), importedAt: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("adopted"), agent: z.enum(["codex", "claude", "kimi", "opencode"]), sourcePath: z.string().min(1), sourceIdentity: z.string().min(1), importedAt: z.number().int().nonnegative() }).strict(),
]);
const generationSchema = z.object({
  generationId: z.string().min(1),
  digest: digestSchema,
  packageDirectory: z.string().regex(/^[a-f0-9]{64}$/),
  importedAt: z.number().int().nonnegative(),
  /* 导入复核那一刻的来源 revision：候选超预算未哈希（digest=null）时，
     「已是最新还是有更新」只能靠它比。 */
  sourceRevision: z.string().min(1),
}).strict();
const originSchema = z.object({
  agent: z.enum(["codex", "claude", "kimi", "opencode"]),
  sourcePath: z.string().min(1),
  sourceIdentity: z.string().min(1),
  digest: digestSchema,
}).strict();
const entrySchema = z.object({
  libraryId: z.string().min(1),
  /* The slug is the account-wide identity the server CASes on, so the store and
     the wire must admit exactly the same grammar. */
  name: skillSlugSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
  requires: z.string().min(1).optional(),
  enabled: z.boolean(),
  tombstoneAt: z.number().int().nonnegative().nullable(),
  provenance: provenanceSchema,
  generations: z.array(generationSchema).min(1),
  activeGenerationId: z.string().min(1),
  /* Private to this device: what the last downlink did to this entry's identity. */
  notice: z.literal("slug-conflict").nullable().default(null),
  origin: originSchema.nullable(),
}).strict();
export const storeSchema = z.object({
  schemaVersion: z.literal(3),
  revision: z.number().int().nonnegative(),
  entries: z.array(entrySchema),
  projections: z.record(z.string(), z.string()).optional(),
}).strict();

export type Store = z.infer<typeof storeSchema>;
export type ManagedSkillsLibraryEntry = z.infer<typeof entrySchema>;
