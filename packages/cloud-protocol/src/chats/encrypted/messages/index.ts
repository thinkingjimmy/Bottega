/**
 * [INPUT]: Immutable message metadata, exact ciphertext validation and bounded read contracts.
 * [OUTPUT]: Server-safe encrypted message contracts and original-outbox record types.
 * [POS]: Message protocol entry; worker execution is isolated in client.ts.
 */
export * from "./model";
export * from "./wire";
export * from "./journal";
export * from "./functions";
