/**
 * [INPUT]: Public contracts from @bottega/contracts/workflow/run.
 * [OUTPUT]: Re-exports the canonical public contract without another implementation.
 * [POS]: packages/cloud-protocol/src/contracts/workflow private import bridge to the SDK contract authority.
 */
/* The public contract lives in @bottega/contracts (workflow/run); this path stays for the private tree's importers. */
export * from "@bottega/contracts/workflow/run";
