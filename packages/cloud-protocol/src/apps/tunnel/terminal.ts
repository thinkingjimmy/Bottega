/**
 * [INPUT]: Decrypted dormant tunnel responses from the direction-bound codec.
 * [OUTPUT]: Closed terminal reason vocabulary and the reserved authenticated end response.
 * [POS]: S7-only control payload; never registered as a production action or inferred from WebSocket close text.
 */
import type { TunnelHttp } from "./policy";
export type TunnelEndReason = "tunnel-plugin-disabled" | "tunnel-revoked" | "tunnel-expired" | "tunnel-connect-failed";
export function isTunnelEndReason(value: unknown): value is TunnelEndReason {
  return value === "tunnel-plugin-disabled" || value === "tunnel-revoked" || value === "tunnel-expired" || value === "tunnel-connect-failed";
}
export function tunnelEndResponse(reason: TunnelEndReason): TunnelHttp {
  return { status: 410, headers: { "x-tunnel-end": reason }, body: new Uint8Array() };
}
export function readTunnelEnd(value: TunnelHttp): TunnelEndReason | null {
  const reason = value.headers["x-tunnel-end"];
  return value.status === 410 && !value.path && !value.method && value.body.length === 0 &&
    Object.keys(value.headers).length === 1 && isTunnelEndReason(reason) ? reason : null;
}
