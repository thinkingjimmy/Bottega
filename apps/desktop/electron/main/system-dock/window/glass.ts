/**
 * [INPUT]: Depends on Node's addon loader and the compiled `dock-glass.node` beside the Dock helper.
 * [OUTPUT]: Provides applyDockGlass / clearDockGlass. A missing or failing addon returns false / no-ops so the bar can keep the vibrancy fallback.
 * [POS]: system-dock/window glass seam used by DockService when the revealed bar should sample the desktop.
 */

import { existsSync } from "node:fs";
import type { BrowserWindow } from "electron";

type GlassAddon = { apply(handle: Buffer, radius: number): boolean; clear(handle: Buffer): void };
const addons = new Map<string, GlassAddon | null>();

function load(file: string): GlassAddon | null {
  const cached = addons.get(file);
  if (cached !== undefined) return cached;
  if (!existsSync(file)) { addons.set(file, null); return null; }
  try {
    const loaded = { exports: {} as GlassAddon };
    process.dlopen(loaded, file);
    addons.set(file, loaded.exports);
    return loaded.exports;
  } catch (cause) {
    console.warn("[system-dock] glass addon failed", cause);
    addons.set(file, null);
    return null;
  }
}

export function applyDockGlass(window: BrowserWindow, file: string, radius: number): boolean {
  const addon = load(file);
  if (!addon || window.isDestroyed()) return false;
  try { return addon.apply(window.getNativeWindowHandle(), radius) === true; }
  catch (cause) { console.warn("[system-dock] glass apply failed", cause); return false; }
}

export function clearDockGlass(window: BrowserWindow, file: string): void {
  const addon = load(file);
  if (!addon || window.isDestroyed()) return;
  try { addon.clear(window.getNativeWindowHandle()); }
  catch (cause) { console.warn("[system-dock] glass clear failed", cause); }
}
