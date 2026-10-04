/**
 * [INPUT]: Public contracts from @bottega/contracts/model/operations.
 * [OUTPUT]: Re-exports the canonical public contract without another implementation.
 * [POS]: packages/cloud-protocol/src/contracts private import bridge to the SDK contract authority.
 */
/* The public contract lives in @bottega/contracts (model/operations); this path stays for the private tree's importers. */
export * from "@bottega/contracts/model/operations";
/* projectRemoteReceipt adapts the private remote ledger, so it lives in remote/operation-receipt.ts, not in the public contract. */
export { projectRemoteReceipt } from "../remote/operation-receipt";
