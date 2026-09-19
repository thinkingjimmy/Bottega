/**
 * [INPUT]: Scalar-exact password validation, bounded foreground scheduling and a host-owned dedicated-worker facade.
 * [OUTPUT]: Shared password minimum, client crypto and queue APIs without eager WASM loading or event-loop KDF access.
 * [POS]: Public client entry; pure wire contracts remain in cloud-protocol/encryption.
 */
export { MIN_PASSWORD_CODE_POINTS, encodePassword, passwordsMatch, validatePassword, validateNewPassword } from "./password";
export { createCryptoWorkerOwner, type CryptoWorkerOwner, type CryptoWorkerOwnerOptions } from "./worker/owner";
export type { CryptoCommand, CryptoResult, CryptoWorkerPort, CryptoWorkerRequest, CryptoWorkerResponse } from "./worker/model";
export type { BackendEvidence } from "./worker/engine/backend";
export { CryptoQueue, cryptoConcurrency } from "./queue";
