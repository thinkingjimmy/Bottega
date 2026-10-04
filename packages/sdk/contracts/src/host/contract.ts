/**
 * [INPUT]: None; dependency-free so the utility-host entry can read it without the protocol's validators.
 * [OUTPUT]: Provides HOST_LAUNCH_CONTRACT (frozen at version 1) and HOST_GRAMMAR, re-exported by protocol.ts and by the desktop host.
 * [POS]: The one definition both halves of the host handshake compare at hello: main's launcher and the host entry. Frozen: a change is a new contract version.
 */

/**
 * Frozen after the packaged probes passed: the host launch (approved entry + digest, explicit environment, this handshake), the sealed
 * turn launch, and the bridge vocabulary. Main's launch names this version and the host's hello repeats it; each half refuses the
 * other's at hello, so a bridge build and a main build can only disagree loudly. Any change bumps it.
 */
export const HOST_LAUNCH_CONTRACT = Object.freeze({ version: "1", frozen: true } as const);
export const HOST_GRAMMAR = 1 as const;
