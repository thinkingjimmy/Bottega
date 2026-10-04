/**
 * [INPUT]: Closed encrypted-file descriptors and original-outbox persistence records.
 * [OUTPUT]: Server-safe ciphertext metadata, client-only inner descriptor and typed custody contracts.
 * [POS]: Shared file protocol entry; worker execution is available only through the explicit client subpath.
 */
export * from "./model";
export * from "./journal";
