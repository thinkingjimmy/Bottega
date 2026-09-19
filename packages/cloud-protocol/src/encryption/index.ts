/**
 * [INPUT]: Pure encrypted-sync model, bounds, context and wire helpers.
 * [OUTPUT]: Candidate server-safe encrypted synchronization format and immutable byte identities.
 * [POS]: Explicit encryption subpath; deliberately independent of client WASM and key ownership.
 */
export * from "./model";
export * from "./limits";
export * from "./context";
export * from "./wire";
export * from "./domains";
export { canonicalJson, encodeBase64url, decodeBase64url, hashCanonical, scalarCount, sameBytes } from "./encoding";
