/**
 * [INPUT]: Public contracts from @bottega/contracts/base/binding.
 * [OUTPUT]: Re-exports the canonical public contract without another implementation.
 * [POS]: packages/cloud-protocol/src/contracts/base private import bridge to the SDK contract authority.
 */
/* The public contract lives in @bottega/contracts (base/binding); this path stays for the private tree's importers. */
export * from "@bottega/contracts/base/binding";
