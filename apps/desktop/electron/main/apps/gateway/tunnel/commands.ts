/**
 * [INPUT]: Authenticated resource envelopes, the account cipher, target identity and the dormant grant owner.
 * [OUTPUT]: openTunnelEffect; validated commands become effects only after the existing inbox records acceptance.
 * [POS]: Non-production R-24 extension; no action is added to the production protocol registry.
 */
import type { EncryptedResourceCommand, EncryptedResourceResult } from "@ai-chat/cloud-protocol/resources/model";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted/model";
import { openTunnelCommand, sealTunnelResult } from "@ai-chat/cloud-protocol/apps/tunnel/commands";
import type { DormantServerTunnels } from "./grants";
export type TunnelEffect = () => Promise<EncryptedResourceResult>;
export async function openTunnelEffect(command: EncryptedResourceCommand, deviceId: string, crypto: FileCipherPort,
  grants: DormantServerTunnels, appOfLease: (leaseId: string) => Promise<string>): Promise<TunnelEffect> {
  const body = await openTunnelCommand(command, deviceId, crypto);
  return async () => {
    if (command.expiresAt <= Date.now()) throw new Error("command-expired");
    if (body.action === "close-tunnel") {
      grants.closeGrant(body.grantId, command.sourceDeviceId);
      return sealTunnelResult(command, { ok: true, grant: null }, crypto);
    }
    if (await appOfLease(body.surfaceLeaseId) !== command.resourceId) throw new Error("invalid-command");
    const grant = await grants.open(body.surfaceLeaseId, command.sourceDeviceId, "remote");
    try { return await sealTunnelResult(command, { ok: true, grant }, crypto); }
    catch (error) { grants.closeGrant(grant.grantId, command.sourceDeviceId); throw error; }
    finally { grant.sessionKey = ""; }
  };
}
