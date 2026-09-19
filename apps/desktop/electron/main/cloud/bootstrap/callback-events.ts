/**
 * [INPUT]: Depends on Electron's open-url event port and the build's fixed callback scheme.
 * [OUTPUT]: Captures one bounded cold-start callback before the application composition loads.
 * [POS]: Bootstrap inbox; the account owner later verifies the persisted state before focusing.
 */
import type { App, Event } from "electron";
let inbox: { bind(handler: (url: string) => void): void; close(): void } | null = null;
export function installCloudCallbackInbox(app: Pick<App, "on" | "removeListener">, scheme: string) {
  if (inbox) return inbox;
  let pending: string | null = null, receive: ((url: string) => void) | null = null;
  const open = (event: Event, url: string) => {
    if (url.length > 512 || !url.startsWith(scheme + "://")) return;
    event.preventDefault();
    if (receive) receive(url); else pending = url;
  };
  app.on("open-url", open);
  inbox = { bind(handler) { receive = handler; if (pending) { const url = pending; pending = null; handler(url); } },
    close() { app.removeListener("open-url", open); receive = null; pending = null; inbox = null; } };
  return inbox;
}
