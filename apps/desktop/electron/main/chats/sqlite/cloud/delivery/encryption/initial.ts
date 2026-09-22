/**
 * [INPUT]: Original outbox-retained native bodies and committed immutable ciphertext message/page mappings.
 * [OUTPUT]: Validates full original/ciphertext manifest chains and exact page receipt identity before Store admission.
 * [POS]: Native initialization integrity leaf in the sole SQLite delivery transaction.
 */
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { EMPTY_CHAT_BODY_DIGEST, extendChatBodyDigest, hashChatInitialPage } from "@ai-chat/cloud-protocol/chats/transcript/initial";
import { validateInitialPacket, hashEncryptedInitialPage } from "@ai-chat/cloud-protocol/chats/encrypted/initial";
import type { SqliteDatabase } from "../../../connection";
import type { Row } from "../../../repository/codec";
import { chatDeliveryCheckpointSchema, type ChatDeliveryCheckpoint } from "../contracts";
export function validateInitialEncryptionCheckpoint(db: SqliteDatabase, outboxId: string, chatId: string, value: ChatDeliveryCheckpoint,
  prior: (key: string) => ChatDeliveryCheckpoint) {
  if (value.kind === "encrypted-native-manifest") {
    const original = prior("native-manifest"), wire = value.transport;
    if (original.kind !== "native-manifest" || value.plaintextHash !== hashChatContent(original.manifest) || wire.chatId !== chatId) throw new Error("NATIVE_CIPHER_MANIFEST_MISMATCH");
    const { proof: _proof, digest: _cipherDigest, ...cipherIdentity } = wire, { digest: _originalDigest, ...originalIdentity } = original.manifest;
    if (hashChatContent(cipherIdentity) !== hashChatContent(originalIdentity)) throw new Error("NATIVE_CIPHER_MANIFEST_MISMATCH");
    validateInitialPacket(value.encryptedSpace.scope, wire);
    const rows = db.prepare(`SELECT s.payload_json FROM cloud_outbox_checkpoints c JOIN chat_retained_sources s ON s.source_id=c.source_id
      WHERE c.outbox_id=? AND json_extract(s.payload_json,'$.kind')='encrypted-message-complete'
        AND json_extract(s.payload_json,'$.message.membership.source')='native'
      ORDER BY json_extract(s.payload_json,'$.message.membership.seq')`).all(outboxId) as Row[];
    let plaintextDigest = EMPTY_CHAT_BODY_DIGEST, ciphertextDigest = EMPTY_CHAT_BODY_DIGEST, seq = 0;
    for (const row of rows) {
      const complete = chatDeliveryCheckpointSchema.parse(JSON.parse(String(row.payload_json)));
      if (complete.kind !== "encrypted-message-complete" || complete.message.membership.chatId !== chatId ||
        complete.message.membership.incarnationId !== wire.incarnationId || complete.message.membership.seq <= seq) throw new Error("NATIVE_CIPHER_BODY_MISMATCH");
      seq = complete.message.membership.seq;
      const body = prior(`body:${seq}`);
      if (body.kind !== "native-body" || body.bodyHash !== complete.plaintextHash) throw new Error("NATIVE_CIPHER_BODY_MISMATCH");
      plaintextDigest = extendChatBodyDigest(plaintextDigest, complete.plaintextHash); ciphertextDigest = extendChatBodyDigest(ciphertextDigest, complete.message.bodyHash);
    }
    if (rows.length !== wire.messageCount || seq !== wire.throughSeq || plaintextDigest !== original.manifest.digest || ciphertextDigest !== wire.digest) throw new Error("NATIVE_CIPHER_DIGEST_MISMATCH");
  }
  if (value.kind === "encrypted-native-page") {
    const manifest = prior("encrypted-native-manifest"), wire = value.transport;
    if (manifest.kind !== "encrypted-native-manifest" || wire.chatId !== chatId || wire.incarnationId !== manifest.transport.incarnationId ||
      wire.manifestId !== manifest.transport.manifestId ||
      wire.offset + wire.bodyHashes.length > manifest.transport.messageCount || hashEncryptedInitialPage(wire) !== wire.ciphertextHash) throw new Error("NATIVE_CIPHER_PAGE_MISMATCH");
    validateInitialPacket(value.encryptedSpace.scope, wire);
    const bodyHashes = wire.bodyHashes.map(hash => {
      const rows = db.prepare(`SELECT s.payload_json FROM cloud_outbox_checkpoints c JOIN chat_retained_sources s ON s.source_id=c.source_id
        WHERE c.outbox_id=? AND json_extract(s.payload_json,'$.kind')='encrypted-message-complete'
          AND json_extract(s.payload_json,'$.message.bodyHash')=?`).all(outboxId, hash) as Row[];
      if (rows.length !== 1) throw new Error("NATIVE_CIPHER_BODY_REQUIRED");
      const complete = chatDeliveryCheckpointSchema.parse(JSON.parse(String(rows[0]!.payload_json)));
      if (complete.kind !== "encrypted-message-complete" || complete.message.membership.source !== "native") throw new Error("NATIVE_CIPHER_BODY_REQUIRED");
      return complete.plaintextHash;
    });
    const { proof: _proof, ciphertextHash: _hash, ...page } = wire;
    if (hashChatInitialPage({ ...page, bodyHashes, payloadHash: "0".repeat(64) }) !== value.plaintextHash) throw new Error("NATIVE_CIPHER_HASH_PAIR_MISMATCH");
  }
  if (value.kind === "native-page") {
    const frozen = prior(`cipher-native-page:${value.receipt.operationId}`), receipt = value.receipt;
    if (frozen.kind !== "encrypted-native-page" || receipt.chatId !== chatId || receipt.payloadHash !== frozen.plaintextHash ||
      receipt.manifestId !== frozen.transport.manifestId || receipt.receivedCount !== frozen.transport.offset + frozen.transport.bodyHashes.length) throw new Error("NATIVE_CIPHER_RECEIPT_MISMATCH");
  }
}
