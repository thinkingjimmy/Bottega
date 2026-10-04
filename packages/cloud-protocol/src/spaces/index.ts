/**
 * [INPUT]: Depends on immutable space models and the two closed mutation contracts.
 * [OUTPUT]: Exposes space schemas, request/result types, limits and spacesFunctions.
 * [POS]: Public server-safe space subpath; no client key material or KDF implementation.
 */
export * from "./model";
export * from "./functions";
export * from "./authority";
