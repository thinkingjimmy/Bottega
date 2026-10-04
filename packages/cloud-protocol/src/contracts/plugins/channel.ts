/**
 * [INPUT]: Public contracts from @bottega/contracts/plugins/channel.
 * [OUTPUT]: Re-exports the canonical public contract without another implementation.
 * [POS]: packages/cloud-protocol/src/contracts/plugins private import bridge to the SDK contract authority.
 */
/* The public contract lives in @bottega/contracts (plugins/channel); this path stays for the private tree's importers. */
export * from "@bottega/contracts/plugins/channel";
