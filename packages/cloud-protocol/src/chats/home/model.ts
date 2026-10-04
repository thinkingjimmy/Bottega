/**
 * [INPUT]: Depends on closed logical file descriptors, public identities and canonical content hashing.
 * [OUTPUT]: Provides portable Home entries, covered-turn manifests and receipts, reserving internal restore filenames.
 * [POS]: Home snapshot wire contract; every path is relative and every byte object is immutable.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../../auth";
import { blobDescriptorSchema, sha256Schema as hash } from "../../blobs";
import { versionSchema as rev } from "../../scalars";
import { hashChatContent } from "../transcript/body";
export const HOME_RESTORE_TEMP_PREFIX = ".ai-chat-restore-";
export const MAX_HOME_BYTES = 200_000_000;
export const MAX_HOME_ENTRIES = 10000;
export const homePathSchema = z.string().min(1).max(1024).refine(path => {
  const parts = path.split("/");
  return parts.length <= 32 && parts.every(part => part.length > 0 && part !== "." && part !== ".." &&
    !/[\\:]/.test(part) && ![...part].some(character => character.charCodeAt(0) < 32) && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) &&
    !parts.some(part => ["node_modules", ".git", ".venv", "__pycache__", "dist", "build", "target", ".ai-chat-home.json"].includes(part.toLowerCase()) || part.toLowerCase().endsWith(".log") || part.toLowerCase().startsWith(HOME_RESTORE_TEMP_PREFIX));
}, "Invalid portable Home path");
export const homeEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: homePathSchema, mode: z.union([z.literal(420), z.literal(493)]), blob: blobDescriptorSchema }).strict(),
  z.object({ kind: z.literal("omitted"), path: homePathSchema,
    reason: z.enum(["file-too-large", "home-too-large", "unsupported-file", "unreadable"]) }).strict(),
]);
export type HomeEntry = z.infer<typeof homeEntrySchema>;
export const homeManifestSchema = z.object({ chatId: id, incarnationId: id, snapshotId: id, throughSeq: rev.default(0),
  expectedSnapshotId: id.nullable(), entryCount: rev.max(MAX_HOME_ENTRIES), bytes: rev.max(MAX_HOME_BYTES), omittedCount: rev.max(MAX_HOME_ENTRIES), digest: hash,
}).strict().refine(value => value.omittedCount <= value.entryCount);
export type HomeManifest = z.infer<typeof homeManifestSchema>;
export const homeStatusSchema = z.object({ manifest: homeManifestSchema, state: z.enum(["receiving", "ready", "superseded"]), receivedCount: rev,
  receivedDigest: hash, bytes: rev, omittedCount: rev }).strict();
export const homePageSchema = z.object({ chatId: id, incarnationId: id, snapshotId: id,
  operationId: id, payloadHash: hash, offset: rev, entries: z.array(homeEntrySchema).min(1).max(50) }).strict();
export const homeReceiptSchema = z.object({ chatId: id, snapshotId: id, operationId: id, payloadHash: hash, sourceDeviceId: id,
  receivedCount: rev, state: z.enum(["receiving", "ready"]), createdAt: rev }).strict();
export const EMPTY_HOME_DIGEST = hashChatContent([]);
export const extendHomeDigest = (previous: string, entry: HomeEntry) => hashChatContent([previous, entry]);
export function hashHomePage(value: z.infer<typeof homePageSchema>) { const { payloadHash: _hash, ...payload } = value; return hashChatContent(payload); }
