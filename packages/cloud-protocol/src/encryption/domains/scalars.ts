/**
 * [INPUT]: Zod's closed schemas and Noble's synchronous SHA-256 implementation.
 * [OUTPUT]: Native-compatible business IDs, immutable scope scalars and internal canonical metadata commitments.
 * [POS]: Shared validation only; callers export named domain commitments, never arbitrary dictionaries.
 */
import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { assertCrypto } from "../limits";
import { agentBackendIdSchema } from "../../chats/options";
export const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-][A-Za-z0-9._:-]*$/);
const scopeId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).refine(value => !Object.is(value, -0));
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const nullableId = id.nullable();
const referenceSchema = z.object({ blobId: id, ciphertextHash: digest, ciphertextBytes: version.positive() }).strict();
export const referencesSchema = z.array(referenceSchema).max(64).refine(items => new Set(items.map(item => item.blobId)).size === items.length);
export const agent = agentBackendIdSchema;
export const scopeSchema = z.object({ sourceEnvironment: scopeId, sourceAccountId: scopeId, vaultId: scopeId, keyId: scopeId }).strict();
export function checked<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  assertCrypto(result.success);
  return result.data;
}
export function commitment<S extends z.ZodType>(domain: string, schema: S, value: z.input<S>): string {
  const bytes = new TextEncoder().encode(JSON.stringify([1, "bottega-allowed-metadata", domain, checked(schema, value)]));
  assertCrypto(bytes.byteLength <= 262_144);
  return bytesToHex(sha256(bytes));
}
