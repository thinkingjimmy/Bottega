/**
 * [INPUT]: Depends on React context only; hosts inject where a URL leaving the app opens.
 * [OUTPUT]: Provides LinkPurpose, LinkPort, the browser default port (new tab, noopener), LinkPortProvider, useLinkPort and linkPurposeOf.
 * [POS]: The chat-ui link port (mobile W17): desktop opens the third-column Browser, Web a new tab, the native shell the system browser.
 */
import { createContext, useContext } from "react";
/* Mirrors the shell's purposes: an artifact link, an ordinary browser-context page, or a preview session with its own cookie jar. */
export type LinkPurpose = "artifact" | "web-context" | "preview-session";
export type LinkPort = { open(url: string, purpose: LinkPurpose): void | Promise<void> };
export const browserLinkPort: LinkPort = { open: url => { window.open(url, "_blank", "noopener,noreferrer"); } };
const Context = createContext<LinkPort>(browserLinkPort);
export const LinkPortProvider = Context.Provider;
export const useLinkPort = () => useContext(Context);
/* A Quick Tunnel preview authenticates with a host-only cookie of its own host; the shell must not open it in the app's jar. */
export function linkPurposeOf(url: string): LinkPurpose {
  try { return new URL(url).hostname.endsWith(".trycloudflare.com") ? "preview-session" : "web-context"; } catch { return "web-context"; }
}
