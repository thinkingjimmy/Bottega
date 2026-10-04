/**
 * [INPUT]: Closed domain contexts and bounded canonical scalar/tuple encoding.
 * [OUTPUT]: Payload-v2 AAD identity with named domain bindings and exact expected-context comparisons.
 * [POS]: Pure authenticated namespace; key-package source scope remains version one.
 */
import { assertCrypto } from "./limits";
import { exactKeys, opaqueId, sameBytes, tuple, utf8 } from "./encoding";
import { MAX_CONTEXT_BYTES, ENCRYPTION_VERSION } from "./limits";
import { domainContextSchema } from "./domains";
import { checked } from "./domains/scalars";
import type { CryptoContext, CryptoScope } from "./model";
const scopeKeys = ["sourceEnvironment", "sourceAccountId", "vaultId", "keyId"] as const;
export function scopeTuple(scope: CryptoScope): unknown[] {
  exactKeys(scope, scopeKeys);
  return scopeKeys.map(key => opaqueId(scope[key]));
}
export function parseScopeTuple(value: unknown): CryptoScope {
  const t = tuple(value, 4).map(opaqueId);
  return { sourceEnvironment: t[0], sourceAccountId: t[1], vaultId: t[2], keyId: t[3] };
}
export function scopeOf(context: CryptoScope): CryptoScope {
  return { sourceEnvironment: context.sourceEnvironment, sourceAccountId: context.sourceAccountId, vaultId: context.vaultId, keyId: context.keyId };
}
export function contextTuple(input: CryptoContext): unknown[] {
  const context = checked(domainContextSchema, input);
  const result = [ENCRYPTION_VERSION, ...scopeTuple(scopeOf(context)), context.purpose, context.entityKind, context.entityId, context.operationId, context.binding];
  assertCrypto(utf8.encode(JSON.stringify(result)).byteLength <= MAX_CONTEXT_BYTES);
  return result;
}
export function parseContextTuple(value: unknown): CryptoContext {
  const t = tuple(value, 10);
  assertCrypto(t[0] === ENCRYPTION_VERSION, "sync-encryption-unsupported");
  const context = checked(domainContextSchema, { ...parseScopeTuple(t.slice(1, 5)), purpose: t[5], entityKind: t[6], entityId: t[7], operationId: t[8], binding: t[9] });
  assertCrypto(JSON.stringify(contextTuple(context)) === JSON.stringify(value));
  return context;
}
export const encodeContext = (context: CryptoContext): Uint8Array => utf8.encode(JSON.stringify(contextTuple(context)));
export function assertExpectedScope(actual: CryptoScope, expected: CryptoScope): void {
  assertCrypto(JSON.stringify(scopeTuple(scopeOf(actual))) === JSON.stringify(scopeTuple(scopeOf(expected))), "sync-space-changed");
}
export function assertExpectedContext(actual: CryptoContext, expected: CryptoContext): void {
  assertExpectedScope(actual, expected);
  assertCrypto(sameBytes(encodeContext(actual), encodeContext(expected)));
}
