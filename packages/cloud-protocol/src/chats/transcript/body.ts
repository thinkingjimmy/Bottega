/**
 * [INPUT]: Depends on canonical message/Subagent codecs, logical files and content hashing.
 * [OUTPUT]: Provides private transcript bundles and local integrity summaries, including encrypted file manifests.
 * [POS]: Client plaintext boundary; legacy storage codecs remain local-only and are absent from public wire functions.
 */
import { z } from "zod";
import { canonicalJson } from "../../encryption/encoding";
import { versionSchema } from "../../scalars";
import { hashCanonical } from "../../encryption/encoding";
import { cloudIdSchema } from "../../auth";
import { CLOUD_LIMITS } from "../../config";
import { blobDescriptorSchema, sha256Schema, type BlobDescriptor } from "../../blobs";
import { encryptedFileDescriptorSchema } from "../../blobs/encrypted/model";
import { messageSchema, subagentsSchema } from "../content/messages";
import { SUBAGENT_BYTE_LIMIT } from "../content/budgets";
import { utf8Length } from "../content/parts";
export const CHAT_BODY_LIMITS = { inlineBytes: 48 * 1024, wireBytes: 4 * 1024 * 1024, pageBytes: CLOUD_LIMITS.maxPageBytes, references: CLOUD_LIMITS.maxReferences } as const;
const privateFile = z.union([encryptedFileDescriptorSchema, blobDescriptorSchema]);
const attachment = z.object({ attachmentId: z.string().regex(/^[A-Za-z0-9_-]{10,64}$/), blob: privateFile }).strict();
const media = z.object({ itemId: z.string().min(1).max(256), subagentId: z.string().min(1).max(256).nullable(), blob: privateFile }).strict();
export const chatBodySchema = z.object({ version: z.literal(1), message: messageSchema,
  subagents: subagentsSchema.optional(), attachments: z.array(attachment).max(8), media: z.array(media).max(64),
}).strict().superRefine((body, ctx) => {
  const add = (message: string) => ctx.addIssue({ code: "custom", message });
  if (body.subagents && (body.message.role !== "assistant" || utf8Length(canonicalJson(body.subagents)) > SUBAGENT_BYTE_LIMIT)) add("chat-subagent-budget-or-role");
  const expected = body.message.role === "user" ? body.message.attachments ?? [] : [];
  if (expected.length !== body.attachments.length || new Set(body.attachments.map(item => item.attachmentId)).size !== body.attachments.length ||
    body.attachments.some(item => !expected.some(value => value.id === item.attachmentId && value.byteSize === item.blob.bytes && value.mediaType === item.blob.mime))) add("chat-attachment-mismatch");
  const keys = new Set<string>();
  for (const item of body.media) {
    const key = canonicalJson([item.subagentId, item.itemId]);
    const parts = item.subagentId ? body.subagents?.[item.subagentId]?.parts : body.message.role === "assistant" ? body.message.parts : [];
    if (keys.has(key) || !parts?.some(part => part.type === "tool" && part.itemId === item.itemId && part.tool === "image" && part.status === "completed") ||
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(item.blob.mime)) add("chat-media-mismatch");
    keys.add(key);
  }
  const blobs = [...body.attachments, ...body.media].map(value => value.blob);
  const unique = new Map<string, BlobDescriptor>();
  for (const blob of blobs) {
    const prior = unique.get(blob.blobId);
    if (prior && canonicalJson(prior) !== canonicalJson(blob)) add("chat-blob-identity-conflict");
    unique.set(blob.blobId, blob);
  }
  if (unique.size > CHAT_BODY_LIMITS.references || utf8Length(canonicalJson(body)) > CHAT_BODY_LIMITS.wireBytes) add("chat-body-budget");
});
export type ChatBody = z.infer<typeof chatBodySchema>;
export const hashChatContent = hashCanonical;
export const chatBodyStorageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inline"), body: chatBodySchema }).strict(),
  z.object({ kind: z.literal("blob"), blob: blobDescriptorSchema }).strict(),
]);
export const chatBodyStageSchema = z.object({ chatId: cloudIdSchema, incarnationId: cloudIdSchema, executionEpoch: versionSchema,
  bodyHash: sha256Schema, storage: chatBodyStorageSchema }).strict();
