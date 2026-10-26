/**
 * [INPUT]: Depends on Node's addon loader and the compiled `dock-glass.node` beside the Dock helper.
 * [OUTPUT]: Provides applyDockGlass / clearDockGlass and measureDockMenu for native menu dimensions. A missing or failing addon retains the existing glass fallback and a conservative menu-size fallback.
 * [POS]: system-dock/window native-addon seam for bar glass and item-anchored menus.
 */

import { existsSync } from "node:fs";
import type { BrowserWindow, Menu } from "electron";

type GlassAddon = { apply(handle: Buffer, radius: number): boolean; clear(handle: Buffer): void;
  measureMenu(labels: readonly (string | null)[]): { width: number; height: number } | null };
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

export function measureDockMenu(menu: Menu, file: string): { width: number; height: number } {
  const labels = menu.items.filter(item => item.visible).map(item => item.type === "separator" ? null : item.label);
  try {
    const size = load(file)?.measureMenu(labels);
    if (size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0) return size;
  } catch (cause) { console.warn("[system-dock] menu measurement failed", cause); }
  // A conservative fallback keeps menus outside the strip if the optional native addon cannot load.
  return { width: Math.max(240, ...labels.map(label => [...(label ?? "")].length * 18 + 48)),
    height: 24 + labels.reduce((height, label) => height + (label === null ? 16 : 36), 0) };
}
