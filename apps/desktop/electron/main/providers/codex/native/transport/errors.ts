/**
 * [INPUT]: Uses native RPC codes and bounded transport failure kinds.
 * [OUTPUT]: Exports NativeRpcError and NativeTransportError.
 * [POS]: Lightweight shared error identity; does not load the connection or item renderer.
 */
export class NativeRpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) { super(message); this.name = "NativeRpcError"; }
}
export class NativeTransportError extends Error {
  constructor(readonly nativeKind: "protocol" | "timeout" | "exit", message: string) { super(`Native ${nativeKind}: ${message}`); this.name = "NativeTransportError"; }
}
