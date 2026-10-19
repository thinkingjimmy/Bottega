/**
 * [INPUT]: Depends on Electron BrowserWindow/ipcMain, the frame guard, the isolated system-dock preload, and the shared bar/panel channels and intent validator.
 * [OUTPUT]: Provides least-privilege Dock windows and DockIpc, authorizing snapshots/intents/icons and panel-only bounded download visuals by live webContents, main frame and exact URL.
 * [POS]: system-dock/window trust boundary (INV-13); stale, destroyed or foreign senders are rejected before any intent reaches DockService.
 */

import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { devRendererUrl, rendererMatches } from "../../window/security/frame-guard";
import { dockIntentSchema, downloadVisualRequestSchema, SYSTEM_DOCK_CHANNEL, type DockIntent, type DownloadVisual, type DownloadVisualRequest } from "../../../../shared/system-dock/ipc";

export type DockRole = "bar" | "panel";
export function dockEntryUrl(mainDirectory: string, role: DockRole, rendererUrl = devRendererUrl(app.isPackaged)) {
  const file = role === "bar" ? "system-dock-bar.html" : "system-dock-panel.html";
  return rendererUrl ? `${rendererUrl.replace(/\/$/, "")}/${file}` : pathToFileURL(join(mainDirectory, "../renderer", file)).href;
}
export function createDockSurface(input: { mainDirectory: string; role: DockRole; url: string; focusable: boolean; onGone(): void }): BrowserWindow {
  const window = new BrowserWindow({ show: false, frame: false, transparent: true, backgroundColor: "#00000000", resizable: false, movable: false, skipTaskbar: true, hasShadow: input.role === "panel",
    type: "panel", hiddenInMissionControl: true, focusable: input.focusable, acceptFirstMouse: true, minimizable: false, maximizable: false, fullscreenable: false,
    // The bar's native material (set per reveal by the service) is clipped by these corners; keep it active while unfocused.
    roundedCorners: true, visualEffectState: "active", width: 200, height: 40,
    webPreferences: { preload: join(input.mainDirectory, "../preload/system-dock.js"), sandbox: true, contextIsolation: true, nodeIntegration: false,
      additionalArguments: [`--system-dock-role=${input.role}`], backgroundThrottling: false, spellcheck: false } });
  // Keep Bottega's own process type while joining every ordinary Space (see notch precedent, C13).
  // The passive bar stays out of native full screen; the panel is the keyboard entry and must be summonable there (INV-10).
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: input.role === "panel", skipTransformProcessType: true });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => { if (target !== input.url) event.preventDefault(); });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("render-process-gone", () => input.onGone());
  return window;
}

type Handlers = { snapshot(role: DockRole): unknown; intent(role: DockRole, intent: DockIntent): Promise<void>; icons(role: DockRole, keys: string[]): Promise<Record<string, string>>;
  downloadVisual(role: DockRole, input: DownloadVisualRequest): Promise<DownloadVisual | null> };
export class DockIpc {
  private readonly surfaces = new Map<DockRole, { window: BrowserWindow; url: string }>();
  constructor(private readonly handlers: Handlers) {
    ipcMain.handle(SYSTEM_DOCK_CHANNEL.snapshot, (event) => this.handlers.snapshot(this.trusted(event)));
    ipcMain.handle(SYSTEM_DOCK_CHANNEL.intent, (event, raw: unknown) => {
      const role = this.trusted(event);
      const parsed = dockIntentSchema.safeParse(raw);
      if (!parsed.success) throw new Error("SYSTEM_DOCK_INTENT_INVALID");
      return this.handlers.intent(role, parsed.data);
    });
    ipcMain.handle(SYSTEM_DOCK_CHANNEL.icons, (event, raw: unknown) => {
      const role = this.trusted(event);
      if (!Array.isArray(raw) || raw.length > 128 || raw.some((key) => typeof key !== "string" || !/^i[A-Za-z0-9_-]{8,40}$/.test(key))) throw new Error("SYSTEM_DOCK_ICONS_INVALID");
      return this.handlers.icons(role, raw as string[]);
    });
    ipcMain.handle(SYSTEM_DOCK_CHANNEL.downloadVisual, (event, raw: unknown) => {
      const role = this.trusted(event);
      const input = downloadVisualRequestSchema.safeParse(raw);
      if (role !== "panel" || !input.success) throw new Error("SYSTEM_DOCK_DOWNLOAD_VISUAL_INVALID");
      return this.handlers.downloadVisual(role, input.data);
    });
  }
  bind(role: DockRole, window: BrowserWindow | null, url = "") { if (window) this.surfaces.set(role, { window, url }); else this.surfaces.delete(role); }
  private trusted(event: IpcMainInvokeEvent): DockRole {
    for (const [role, surface] of this.surfaces) {
      if (surface.window.isDestroyed() || surface.window.webContents !== event.sender) continue;
      if (event.senderFrame !== event.sender.mainFrame || !rendererMatches(event.senderFrame, surface.url)) break;
      return role;
    }
    throw new Error("SYSTEM_DOCK_UNTRUSTED");
  }
  send(role: DockRole, value: unknown) {
    const surface = this.surfaces.get(role);
    if (surface && !surface.window.isDestroyed()) surface.window.webContents.send(SYSTEM_DOCK_CHANNEL.changed, value);
  }
  close() {
    ipcMain.removeHandler(SYSTEM_DOCK_CHANNEL.snapshot); ipcMain.removeHandler(SYSTEM_DOCK_CHANNEL.intent); ipcMain.removeHandler(SYSTEM_DOCK_CHANNEL.icons);
    ipcMain.removeHandler(SYSTEM_DOCK_CHANNEL.downloadVisual);
    this.surfaces.clear();
  }
}
