/**
 * [INPUT]: Scalar-exact password validation, bounded foreground scheduling and a host-owned dedicated-worker facade.
 * [OUTPUT]: Shared unlock minimum, creation assessment, client crypto and queue APIs without eager WASM loading or event-loop KDF access.
 * [POS]: Public client entry; pure wire contracts remain in cloud-protocol/encryption.
 */
export { MIN_PASSWORD_CODE_POINTS, NEW_PASSWORD_REASONS, assessNewPassword, passwordsMatch, validatePassword, validateNewPassword,
  type NewPasswordReason } from "./password";
export { createCryptoWorkerOwner, type CryptoWorkerOwner } from "./worker/owner";
export type { CryptoCommand, CryptoResult, CryptoWorkerPort, CryptoWorkerRequest, CryptoWorkerResponse, KeyHandoffPort } from "./worker/model";
export type { BackendEvidence } from "./worker/engine/backend";
export { CryptoQueue, cryptoConcurrency } from "./queue";
