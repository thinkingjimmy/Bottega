/**
 * [INPUT]: Depends on the fixed account/device preload API and one expected account identity.
 * [OUTPUT]: Resolves an attachment's source name from bounded device pages with account checks before and after every read.
 * [POS]: Cloud-only Base attachment name adapter; no paths, credentials or cross-account cache are exposed.
 */
import type { CloudBridgeApi } from "../../../../shared/cloud-ipc";
import { createDeviceNameReader } from "@ai-chat/cloud-protocol/auth/device-names";

export function desktopBaseDeviceName(bridge: Pick<CloudBridgeApi, "getAccountState" | "listDevices">, expectedUserId: string) {
  let environment: string | null | undefined;
  return createDeviceNameReader({
    assertCurrent: async () => {
      const account = await bridge.getAccountState();
      if (account.profile?.userId !== expectedUserId || !["ready", "temporarily-offline"].includes(account.status)) throw new Error("account-scope-changed");
      environment ??= account.environmentId;
      if (account.environmentId !== environment) throw new Error("account-scope-changed");
    },
    page: cursor => bridge.listDevices({ cursor }),
  });
}
