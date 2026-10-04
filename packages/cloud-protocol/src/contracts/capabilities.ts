/**
 * [INPUT]: Public contracts from @bottega/contracts/model/capabilities.
 * [OUTPUT]: Re-exports the canonical public contract without another implementation.
 * [POS]: packages/cloud-protocol/src/contracts private import bridge to the SDK contract authority.
 */
/* The public contract lives in @bottega/contracts (model/capabilities); this path stays for the private tree's importers. */
export * from "@bottega/contracts/model/capabilities";
