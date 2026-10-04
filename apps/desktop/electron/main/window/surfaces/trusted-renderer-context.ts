/**
 * [INPUT]: Depends on frame URL matching, WindowRegistry records, and renderer-identity incarnation rotation
 * [OUTPUT]: Provides TrustedRendererContext and resolveTrustedRendererContext with per-call webContents/main-frame/session/role/incarnation proof
 * [POS]: Window surfaces proof boundary for process-global renderer IPC; no renderer-supplied identity field is trusted
 */

import type { WebFrameMain } from "electron";
import type { ProductWindowRole } from "../../../../shared/ipc/settings/window-surfaces-ipc";
import { rendererMatches } from "../security/frame-guard";
import { rendererIdentity } from "../security/renderer-identity";
import {
  type RegisteredBrowserWindow,
  type RegisteredWebContents,
  type WindowRegistry,
  windowRegistry,
} from "./window-registry";

export type TrustedRendererContext = Readonly<{
  windowId: string;
  webContentsId: number;
  sessionPartition: string;
  role: ProductWindowRole;
  rendererIncarnation: string;
  appId: string | null;
  window: RegisteredBrowserWindow;
}>;

export type TrustedRendererEvent = Readonly<{
  sender: RegisteredWebContents;
  senderFrame: WebFrameMain | null;
}>;

export function resolveTrustedRendererContext(
  event: TrustedRendererEvent,
  registry: WindowRegistry = windowRegistry
): TrustedRendererContext {
  const record = registry.fromWebContents(event.sender.id);
  if (!record || record.window.webContents !== event.sender) {
    throw new Error("Unregistered renderer window");
  }
  if (!rendererMatches(event.senderFrame, record.rendererUrl)) {
    throw new Error("Untrusted renderer frame");
  }
  /* `frame.top` alone is a property of whatever frame sent this; the sender's own main frame is the one
     document this record vouches for, and a detached frame belongs to a document that is already gone. */
  if ((event.sender.mainFrame && event.senderFrame !== event.sender.mainFrame) || event.senderFrame?.detached) {
    throw new Error("Untrusted renderer frame");
  }
  if (event.sender.session !== record.session) {
    throw new Error("Renderer session partition changed");
  }
  const identity = rendererIdentity(event.sender.id);
  if (identity.rendererSessionId.startsWith("unbound-")) {
    throw new Error("Renderer incarnation is not bound");
  }
  return {
    windowId: record.windowId,
    webContentsId: record.webContentsId,
    sessionPartition: record.sessionPartition,
    role: record.role,
    rendererIncarnation: identity.rendererSessionId,
    appId: record.appId,
    window: record.window,
  };
}
