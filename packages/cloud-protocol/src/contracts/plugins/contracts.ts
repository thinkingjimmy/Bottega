/**
 * [INPUT]: Public contracts from @bottega/contracts/plugins/contracts.
 * [OUTPUT]: Re-exports the canonical public contract without another implementation.
 * [POS]: packages/cloud-protocol/src/contracts/plugins private import bridge to the SDK contract authority.
 */
/* The public contract lives in @bottega/contracts (plugins/contracts); this path stays for the private tree's importers. */
export * from "@bottega/contracts/plugins/contracts";
