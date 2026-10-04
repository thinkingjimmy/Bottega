/**
 * [INPUT]: Depends on closed portable message/part schemas and canonical SHA-256 hashing.
 * [OUTPUT]: Removes local Gallery provenance and derives the portable result identity.
 * [POS]: Shared projection used by publication and local receipt comparison without filesystem or network access.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { canonicalJson } from "../../encryption/encoding";
import { messageSchema } from "./messages";
import { chatPartSchema } from "./parts";
export function projectPortableMessage(input: unknown) {
  const source = input as { role?: string; parts?: unknown[] };
  const value = source?.role === "assistant" ? { ...source, ...(source.parts ? { parts: source.parts.map(part => {
    const { mediaSource: _local, ...portable } = part as Record<string, unknown>; return chatPartSchema.parse(portable);
  }) } : {}) } : source;
  const message = messageSchema.parse(value);
  if (message.role !== "assistant" || !message.resultHash) return message;
  const resultHash = bytesToHex(sha256(new TextEncoder().encode(canonicalJson({ ...message, resultHash: undefined }))));
  return { ...message, resultHash };
}
