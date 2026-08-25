/**
 * [INPUT]: Depends on Electron ipcMain/WebFrameMain and frame-guard rendererMatches
 * [OUTPUT]: Provides rendererIpc with an injectable createRendererIpcRegistrar; Recycle by window handle, recycle by function on packaging
 * [POS]: Electron main's IPC registers the only input to the cleaning lifecycle of the same window with WeakMap;
 *        Defence failure refuses, business handler cannot get unreliable input
 */

import { ipcMain, type WebFrameMain } from "electron";
import { rendererMatches } from "./frame-guard";

type RendererIpcEvent = { senderFrame: WebFrameMain | null };
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

export type RendererIpcWindow = {
  once(event: "closed", listener: () => void): unknown;
};

export type RendererIpc = {
  /** invoke 通道：非可信主帧直接抛错；handler 只见业务参数。 */
  handle(channel: string, handler: (...args: unknown[]) => unknown): RendererIpc;
  /** fire-and-forget 通道：非可信主帧静默丢弃（与历史 cancel 语义一致）。 */
  on(channel: string, listener: (...args: unknown[]) => void): RendererIpc;
};

export type RendererIpcRegistrar = (
  window: RendererIpcWindow,
  rendererUrl: string,
  rejectMessage: string
) => RendererIpc;

type RendererMatcher = (
  frame: WebFrameMain | null,
  rendererUrl: string
) => boolean;

/** 构造共享窗口账本的注册器；注入边界让生命周期可在纯 Node 中验证。 */
export function createRendererIpcRegistrar(
  main: RendererIpcMain,
  matches: RendererMatcher = rendererMatches
): RendererIpcRegistrar {
  const windowCleanups = new WeakMap<RendererIpcWindow, Set<() => void>>();

  const cleanupBucket = (window: RendererIpcWindow) => {
    const existing = windowCleanups.get(window);
    if (existing) return existing;

    const cleanups = new Set<() => void>();
    windowCleanups.set(window, cleanups);
    window.once("closed", () => {
      windowCleanups.delete(window);
      for (const cleanup of cleanups) cleanup();
      cleanups.clear();
    });
    return cleanups;
  };

  return (window, rendererUrl, rejectMessage) => {
    const cleanups = cleanupBucket(window);
    const trusted = (frame: WebFrameMain | null) => matches(frame, rendererUrl);
    const registrar: RendererIpc = {
      handle(channel, handler) {
        main.handle(channel, (event, ...args) => {
          if (!trusted(event.senderFrame)) throw new Error(rejectMessage);
          return handler(...args);
        });
        cleanups.add(() => main.removeHandler(channel));
        return registrar;
      },
      on(channel, listener) {
        const guarded: RendererIpcListener = (event, ...args) => {
          if (trusted(event.senderFrame)) listener(...args);
        };
        main.on(channel, guarded);
        cleanups.add(() => main.removeListener(channel, guarded));
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
  removeListener: (channel, listener) =>
    ipcMain.removeListener(channel, listener),
};

export const rendererIpc = createRendererIpcRegistrar(electronIpcMain);
