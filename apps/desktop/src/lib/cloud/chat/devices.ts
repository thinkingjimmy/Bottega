/**
 * [INPUT]: Depends on the existing account projection and shared bounded device reader over its facade.
 * [OUTPUT]: Provides bounded device names and presence with account-fenced refreshes.
 * [POS]: Chat display metadata only; presence never supplies an execution lease.
 */
import { useAccountDevices } from "@ai-chat/chat-ui/platform-hooks";
import { useCloudAccount } from "../client";
import { useDesktopAccountFacade } from "./platform/account";
export function useChatDevices() {
  const account = useCloudAccount(), facade = useDesktopAccountFacade(), { devices } = useAccountDevices(facade);
  return { account, devices };
}
