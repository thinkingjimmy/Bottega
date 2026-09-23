/**
 * [INPUT]: Current surface role, an optional visible Browser panel, role-scoped native bridges and the chat-ui LinkPort contract.
 * [OUTPUT]: openInBrowser (a visible built-in panel or the supported external bridge) and desktopLinkPort, the desktop implementation of the shared link port.
 * [POS]: Shared desktop link entry policy for main Chats, App Use Chats and mirror dialogs.
 */
import type { LinkPort } from "@ai-chat/chat-ui/links";
export async function openInBrowser(url: string, openPanel?: () => void): Promise<void> {
  if (openPanel && window.windowSurfaces?.context.role === "main" && window.browser) {
    openPanel();
    await window.browser.createTab({ url });
  } else {
    if (!window.app) throw new Error("artifact-browser-unavailable");
    await window.app.openExternal(url);
  }
}
/* Every purpose lands in the same Browser: desktop has one cookie jar per partition and no system-browser handoff to choose. */
export const desktopLinkPort = (openPanel?: () => void): LinkPort => ({ open: url => openInBrowser(url, openPanel) });
