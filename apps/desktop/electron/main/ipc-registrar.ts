/**
 * [INPUT]: Depends on Electron ipcMain events and the window module's per-call TrustedRendererContext resolver
 * [OUTPUT]: Provides a process-global rendererIpc registrar with replaceable channel owners, role allowlists, context-aware handlers, and silent fail-closed cleanup handlers
 * [POS]: Electron main's sole renderer IPC admission point; window closure never removes process-global handlers
 */

import { ipcMain, type WebContents, type WebFrameMain } from "electron";
import type { ProductWindowRole } from "../../shared/window-surfaces-ipc";
import {
  resolveTrustedRendererContext,
  type TrustedRendererContext,
  type TrustedRendererEvent,
} from "./window/surfaces/trusted-renderer-context";

type RendererIpcEvent = {
  sender?: WebContents;
  senderFrame: WebFrameMain | null;
};
type RendererIpcHandler = (
  event: RendererIpcEvent,
  ...args: unknown[]
) => unknown;
type RendererIpcListener = (
  event: RendererIpcEvent,
  ...args: unknown[]
) => void;

export type RendererIpcMain = {
  handle(channel: string, handler: RendererIpcHandler): void;
  on(channel: string, listener: RendererIpcListener): void;
  removeHandler(channel: string): void;
  removeListener(channel: string, listener: RendererIpcListener): void;
};

/** Retained for source compatibility; the process-global dispatcher never owns a window listener. */
export type RendererIpcWindow = {
  once(event: "closed", listener: () => void): unknown;
};

export type RendererIpc = {
  roles(...roles: ProductWindowRole[]): RendererIpc;
  handle(channel: string, handler: (...args: unknown[]) => unknown): RendererIpc;
  handleWithContext(
    channel: string,
    handler: (context: TrustedRendererContext, ...args: unknown[]) => unknown
  ): RendererIpc;
  handleBestEffortWithContext(
    channel: string,
    handler: (context: TrustedRendererContext, ...args: unknown[]) => unknown
  ): RendererIpc;
  on(channel: string, listener: (...args: unknown[]) => void): RendererIpc;
  onWithContext(
    channel: string,
    listener: (context: TrustedRendererContext, ...args: unknown[]) => void
  ): RendererIpc;
};

export type RendererIpcRegistrar = (
  window: RendererIpcWindow,
  rendererUrl: string,
  rejectMessage: string
) => RendererIpc;

type ContextResolver = (
  event: RendererIpcEvent,
  rendererUrl: string
) => TrustedRendererContext;

/**
 * Registrations are process-global and replace the previous owner of the same channel.
 * Rebuilding the main window refreshes closures without duplicate ipcMain.handle failures,
 * while closing an App window cannot tear down another window's capabilities.
 */
export function createRendererIpcRegistrar(
  main: RendererIpcMain,
  resolve: ContextResolver
): RendererIpcRegistrar {
  const listeners = new Map<string, RendererIpcListener>();

  return (_window, rendererUrl, rejectMessage) => {
    let allowedRoles: ReadonlySet<ProductWindowRole> = new Set(["main"]);
    const context = (
      event: RendererIpcEvent,
      roles: ReadonlySet<ProductWindowRole>
    ) => {
      try {
        const trusted = resolve(event, rendererUrl);
        if (!roles.has(trusted.role)) throw new Error(rejectMessage);
        return trusted;
      } catch {
        throw new Error(rejectMessage);
      }
    };
    const registrar: RendererIpc = {
      roles(...roles) {
        if (!roles.length) throw new Error("Renderer IPC role allowlist is empty");
        allowedRoles = new Set(roles);
        return registrar;
      },
      handle(channel, handler) {
        return registrar.handleWithContext(channel, (_trusted, ...args) =>
          handler(...args)
        );
      },
      handleWithContext(channel, handler) {
        const channelRoles = allowedRoles;
        main.removeHandler(channel);
        main.handle(channel, (event, ...args) =>
          handler(context(event, channelRoles), ...args)
        );
        return registrar;
      },
      handleBestEffortWithContext(channel, handler) {
        const channelRoles = allowedRoles;
        main.removeHandler(channel);
        main.handle(channel, async (event, ...args) => {
          try {
            return await handler(context(event, channelRoles), ...args);
          } catch {
            return undefined;
          }
        });
        return registrar;
      },
      on(channel, listener) {
        return registrar.onWithContext(channel, (_trusted, ...args) =>
          listener(...args)
        );
      },
      onWithContext(channel, listener) {
        const channelRoles = allowedRoles;
        const previous = listeners.get(channel);
        if (previous) main.removeListener(channel, previous);
        const guarded: RendererIpcListener = (event, ...args) => {
          try {
            listener(context(event, channelRoles), ...args);
          } catch {
            /* fire-and-forget channels preserve the existing fail-closed drop semantic */
          }
        };
        listeners.set(channel, guarded);
        main.on(channel, guarded);
        return registrar;
      },
    };
    return registrar;
  };
}

const electronIpcMain: RendererIpcMain = {
  handle: (channel, handler) => ipcMain.handle(channel, handler),
  on: (channel, listener) => ipcMain.on(channel, listener),
  removeHandler: (channel) => ipcMain.removeHandler(channel),
  removeListener: (channel, listener) => ipcMain.removeListener(channel, listener),
};

export const rendererIpc = createRendererIpcRegistrar(
  electronIpcMain,
  (event, _rendererUrl) =>
    resolveTrustedRendererContext(event as unknown as TrustedRendererEvent)
);

