/**
 * [INPUT]: Depends on BrowserWebContentsPort/session; The receiving page is automatically redirected/navigated, window.open, permissions check/request and download events
 * [OUTPUT]: Provides secureBrowserContents, a dual path denial of authorization and unified disruption scheme, download and window.open
 * [POS]: The main/browser web security boundaries; The main defense of the programmed load URL is still single-pointed by BrowserPanelService
 */

import type { BrowserWebContentsPort } from "./browser-service";

const securedSessions = new WeakSet<object>();

export function isSafeBrowserUrl(value: string) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function secureBrowserContents(
  contents: BrowserWebContentsPort,
  options: { openTab(url: string): void }
) {
  const session = contents.session;
  if (!securedSessions.has(session as object)) {
    securedSessions.add(session as object);
    session.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false)
    );
    session.setPermissionCheckHandler(() => false);
    session.on("will-download", (event: { preventDefault(): void }) => {
      event.preventDefault();
    });
  }
  const preventUnsafeNavigation = (
    event: { preventDefault(): void; url?: string },
    legacyUrl?: string
  ) => {
    const url = event.url ?? legacyUrl ?? "";
    if (!isSafeBrowserUrl(url)) event.preventDefault();
  };
  contents.on("will-navigate", preventUnsafeNavigation);
  contents.on("will-redirect", preventUnsafeNavigation);
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeBrowserUrl(url)) options.openTab(url);
    return { action: "deny" };
  });
}
