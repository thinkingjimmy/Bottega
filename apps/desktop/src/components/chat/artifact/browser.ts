/**
 * [INPUT]: Current surface role, an optional visible Browser panel and role-scoped native bridges.
 * [OUTPUT]: URL opening through an available built-in panel or the supported external bridge.
 * [POS]: Shared desktop link entry policy for main Chats, App Use Chats and mirror dialogs.
 */
export async function openInBrowser(url: string, openPanel?: () => void): Promise<void> {
  if (openPanel && window.windowSurfaces?.context.role === "main" && window.browser) {
    openPanel();
    await window.browser.createTab({ url });
  } else {
    if (!window.app) throw new Error("artifact-browser-unavailable");
    await window.app.openExternal(url);
  }
}
