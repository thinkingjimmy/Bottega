/**
 * [INPUT]: Depends on native window/renderer readiness events and exact product-window registration.
 * [OUTPUT]: Provides waitForMainWindowReady and retryable MainWindowUnavailableError with listener cleanup on every exit.
 * [POS]: Main creation boundary shared by startup and background window recovery.
 */

import type { EventEmitter } from "node:events";
import type { WindowRegistry } from "../../window/surfaces/window-registry";

type EventSource = Pick<EventEmitter, "on" | "removeListener"> & { isDestroyed(): boolean };
type MainWindowSource = EventSource & { destroy(): void; webContents: EventSource & { id: number } };

export class MainWindowUnavailableError extends Error {
  constructor() { super("MAIN_WINDOW_UNAVAILABLE"); }
}

export async function waitForMainWindowReady(window: MainWindowSource, windows: WindowRegistry) {
  const contents = window.webContents;
  const record = windows.fromWebContents(contents.id);
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.removeListener("ready-to-show", ready);
      window.removeListener("closed", unavailable);
      contents.removeListener("render-process-gone", unavailable);
      contents.removeListener("destroyed", unavailable);
      contents.removeListener("did-fail-load", failed);
    };
    const finish = (error?: Error) => {
      cleanup();
      if (error) {
        if (!window.isDestroyed()) window.destroy();
        reject(error);
      } else resolve();
    };
    const ready = () => finish();
    const unavailable = () => finish(new MainWindowUnavailableError());
    const failed = (_event: unknown, code: number, description: string, _url: string, isMainFrame: boolean) => {
      if (isMainFrame) finish(new Error(`MAIN_WINDOW_LOAD_FAILED:${code}:${description}`));
    };
    window.on("ready-to-show", ready);
    window.on("closed", unavailable);
    contents.on("render-process-gone", unavailable);
    contents.on("destroyed", unavailable);
    contents.on("did-fail-load", failed);
    if (!record || window.isDestroyed() || contents.isDestroyed()) unavailable();
  });
  if (!record || windows.main() !== record) throw new MainWindowUnavailableError();
  return record;
}
