/**
 * [INPUT]: Depends on the shared ShortcutBinding settings contract.
 * [OUTPUT]: Provides product shortcut identities, defaults, override resolution, and the collision-aware task-panel accelerator.
 * [POS]: Shared shortcut truth consumed by renderer controls and native registration.
 */
import type { ShortcutBinding } from "../settings-ipc";
export type ShortcutId = "search" | "newChat" | "settings" | "saveInstructions" | "findInFile" | "toggleSidebar" | "findInChat" | "taskPanel";
export type ShortcutOverrides = Readonly<Record<string, ShortcutBinding | null>>;
export const SHORTCUT_DEFAULTS: Readonly<Record<ShortcutId, ShortcutBinding>> = {
  search: { key: "k", shift: false },
  newChat: { key: "n", shift: false },
  settings: { key: ",", shift: false },
  saveInstructions: { key: "s", shift: false },
  findInFile: { key: "f", shift: false },
  toggleSidebar: { key: "b", shift: false },
  findInChat: { key: "f", shift: false },
  taskPanel: { key: "p", shift: true },
};
export const SHORTCUT_IDS = Object.keys(SHORTCUT_DEFAULTS) as ShortcutId[];
export function resolveShortcut(id: ShortcutId, overrides: ShortcutOverrides): ShortcutBinding | null {
  return overrides[id] === undefined ? SHORTCUT_DEFAULTS[id] : overrides[id];
}
export type PanelBinding = Readonly<{ accelerator: string | null; conflict: boolean }>;
export function resolvePanelBinding(overrides: ShortcutOverrides): PanelBinding {
  const binding = resolveShortcut("taskPanel", overrides);
  if (!binding) return { accelerator: null, conflict: false };
  const conflict = SHORTCUT_IDS.some((id) => {
    const other = resolveShortcut(id, overrides);
    return id !== "taskPanel" && other?.key === binding.key && other.shift === binding.shift;
  });
  return { accelerator: `Command+${binding.shift ? "Shift+" : ""}${binding.key.toUpperCase()}`, conflict };
}
