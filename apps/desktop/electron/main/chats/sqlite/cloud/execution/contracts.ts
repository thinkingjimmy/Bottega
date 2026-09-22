/**
 * [INPUT]: Depends on closed local identities, committed Home evidence and source references.
 * [OUTPUT]: Defines frozen execution installation and titled retained archive descriptors without local grants.
 * [POS]: Main-to-worker preparation contract; no remote input can create local authority directly.
 */
import { z } from "zod";
import { storageIdSchema as id, storageHashSchema as hash, storageRevisionSchema as rev } from "../../../../../../shared/local-storage/contracts";
import { retainedSourceRefSchema } from "../delivery/contracts";
export const executionInstallSchema = z.object({ type: z.literal("install-execution-prefix"), chatId: id, incarnationId: id,
  requireConverged: z.boolean().optional(),
  bodyRevision: rev, cloudRevision: rev, expectedMessageRevision: rev, expectedOutboxDigest: hash,
  home: z.object({ phase: z.literal("committed"), chatId: id, incarnationId: id, intentId: id, homeDir: z.string().min(1).max(4096) }).strict(),
}).strict();
export const executionArchiveSchema = z.object({ branchId: id, chatId: id, title: z.string().max(500).nullish(), incarnationId: id, bodyRevision: rev, messageCount: rev.optional(),
  canonicalHeadSeq: rev, createdAt: rev, body: retainedSourceRefSchema, parentBranchId: id.optional(), origin: z.enum(["edited", "unsent"]).optional() }).strict();
export const executionInstallResultSchema = z.object({ chatId: id, bodyRevision: rev, branchId: id.nullable() }).strict();
