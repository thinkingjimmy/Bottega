/**
 * [INPUT]: Depends on the public host contract module (@bottega/contracts/host/contract), itself dependency-free.
 * [OUTPUT]: Re-exports HOST_LAUNCH_CONTRACT (frozen at version 1) and HOST_GRAMMAR.
 * [POS]: The desktop path both halves of the host handshake import (main in utility-host.ts, the host in entry.ts); it stays dependency-free so the utility-host entry reads it without the protocol's validators.
 */
export { HOST_GRAMMAR, HOST_LAUNCH_CONTRACT } from "@bottega/contracts/host/contract";
