/**
 * [INPUT]: Original local commitment hashes, authenticated canonical bodies and complete encrypted turn packets.
 * [OUTPUT]: Immutable original-outbox checkpoints and exact file-normalized canonical body source comparison.
 * [POS]: No scheduler or second queue; retries replay the exact stored packet bytes.
 */
import { z } from "zod";
import { encryptedSpaceSchema } from "../../spaces";
import { sha256Schema as hash, contentBlobId } from "../../blobs";
import { canonicalJson } from "../../encryption/encoding";
import { encryptedFileDescriptorSchema } from "../../blobs/encrypted";
import { chatBodySchema, type ChatBody } from "../../chats/transcript/body";
import { encryptedMessageSchema } from "../../chats/encrypted/messages/model";
import { encryptedTurnStartSchema, encryptedTurnChunkSchema, encryptedTurnFinalSchema } from "./model";
const header = { encryptedSpace: encryptedSpaceSchema, plaintextHash: hash };
export const frozenTurnRecords = [
  z.object({ kind: z.literal("encrypted-turn-start"), ...header, start: encryptedTurnStartSchema }).strict(),
  z.object({ kind: z.literal("encrypted-turn-chunk"), ...header, chunk: encryptedTurnChunkSchema }).strict(),
  z.object({ kind: z.literal("encrypted-turn-final"), ...header, final: encryptedTurnFinalSchema }).strict(),
  z.object({ kind: z.literal("encrypted-turn-canonical-body"), ...header, openedPlaintextHash: hash,
    openedBody: chatBodySchema, message: encryptedMessageSchema }).strict(),
] as const;
export function sameTurnBodySource(left: ChatBody, right: ChatBody, userId: string) {
  const normalize = (body: ChatBody) => {
    const file = <T extends { blob: unknown }>(item: T) => {
      const { sha256, bytes, mime } = encryptedFileDescriptorSchema.parse(item.blob);
      return { ...item, blob: { sha256, bytes, mime, blobId: contentBlobId({ sha256, mime }, userId) } };
    };
    return { ...body, attachments: body.attachments.map(file), media: body.media.map(file) };
  };
  return canonicalJson(normalize(left)) === canonicalJson(normalize(right));
}
