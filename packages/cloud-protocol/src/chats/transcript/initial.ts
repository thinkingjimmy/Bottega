/**
 * [INPUT]: Depends on closed identity/revision primitives and deterministic content hashes.
 * [OUTPUT]: Provides frozen native initialization manifests, ordered digest chains and original page receipts.
 * [POS]: Initial publication contract; historical sequence coverage is distinct from new live-turn reservation.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../../auth";
import { versionSchema as rev } from "../../scalars";
import { sha256Schema } from "../../blobs";
import { hashChatContent } from "./body";
export const EMPTY_CHAT_BODY_DIGEST = "0".repeat(64);
export const extendChatBodyDigest = (previous: string, bodyHash: string) => hashChatContent([sha256Schema.parse(previous), sha256Schema.parse(bodyHash)]);
export const chatInitialManifestSchema = z.object({ chatId: id, incarnationId: id, manifestId: id,
  messageCount: rev.max(1_000_000), throughSeq: rev, reservedThroughSeq: rev, digest: sha256Schema, lastCommittedUserSeq: rev.positive().nullable(),
}).strict().refine(value => value.reservedThroughSeq >= value.throughSeq &&
  (value.lastCommittedUserSeq === null || value.lastCommittedUserSeq <= value.throughSeq), { error: "chat-initial-sequence-invalid" });
export type ChatInitialManifest = z.infer<typeof chatInitialManifestSchema>;
export const chatInitialStatusSchema = z.object({ manifestId: id, payloadHash: sha256Schema, state: z.enum(["receiving", "ready"]),
  messageCount: rev, receivedCount: rev, digest: sha256Schema, throughSeq: rev,
}).strict();
export const chatInitialPageSchema = z.object({ chatId: id, incarnationId: id, manifestId: id, operationId: id,
  offset: rev, bodyHashes: z.array(sha256Schema).min(1).max(64), payloadHash: sha256Schema,
}).strict();
export type ChatInitialPage = z.infer<typeof chatInitialPageSchema>;
export function hashChatInitialPage(value: ChatInitialPage) {
  const { payloadHash: _hash, ...payload } = chatInitialPageSchema.parse(value); return hashChatContent(payload);
}
export const chatInitialReceiptSchema = z.object({ chatId: id, operationId: id, payloadHash: sha256Schema, sourceDeviceId: id,
  manifestId: id, receivedCount: rev, state: z.enum(["receiving", "ready"]), bodyRevision: rev, createdAt: rev,
}).strict();
