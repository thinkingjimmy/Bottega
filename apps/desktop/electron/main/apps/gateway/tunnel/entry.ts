/**
 * [INPUT]: Explicit non-production build admission and server-App authority ports.
 * [OUTPUT]: DormantServerTunnels for the test-build composition only.
 * [POS]: S7's independent entry; absent from production inputs and the main closure.
 */
export { DormantServerTunnels } from "./grants";
export { SERVER_TUNNEL_MARKER, tunnelCommandSchema, serverSurfaceSchema } from "@ai-chat/cloud-protocol/apps/tunnel/model";
import type { DormantServerTunnels } from "./grants";
import { openTunnelEffect } from "./commands";
let installed: { grants: DormantServerTunnels; appOfLease(leaseId: string): Promise<string> } | null = null;
/** Test-build composition supplies verified surface leases. The future cloud catalog must not mint them implicitly. */
export function installServerSurfaceAuthority(value: NonNullable<typeof installed>) {
  if (installed) throw new Error("tunnel-authority-already-installed");
  installed = value;
  return async () => { installed = null; await value.grants.close(); };
}
export function resourceExtension() {
  const owner = installed;
  return owner && {
    open: (command: Parameters<typeof openTunnelEffect>[0], deviceId: string, crypto: Parameters<typeof openTunnelEffect>[2]) =>
      openTunnelEffect(command, deviceId, crypto, owner.grants, owner.appOfLease),
    reset: () => owner.grants.revokeAll(),
  };
}
