/**
 * [INPUT]: Depends on the BrowserWebContentsPort/session seam and its will-navigate/will-redirect, window.open, permission check/request, and will-download events
 * [OUTPUT]: Provides secureBrowserContents: HTTP(S)-only navigation and redirects, double rejection of permission checks and requests, blocked downloads, and safe `window.open` routed to a product tab
 * [POS]: main/browser's web security boundary; BrowserPanelService remains the single point that decides which URL gets programmatically loaded
 */

import type { BrowserWebContentsPort } from "./browser-service";

const securedSessions = new WeakSet<object>();

function isSafeBrowserUrl(value: string) {
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
  const preventUnsafeNavigation = (event: { preventDefault(): void; url?: string }) => {
    if (!isSafeBrowserUrl(event.url ?? "")) event.preventDefault();
  };
  contents.on("will-navigate", preventUnsafeNavigation);
  contents.on("will-redirect", preventUnsafeNavigation);
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeBrowserUrl(url)) options.openTab(url);
    return { action: "deny" };
  });
}
