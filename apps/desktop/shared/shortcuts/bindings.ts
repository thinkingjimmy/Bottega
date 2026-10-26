/**
 * [INPUT]: Depends on the shared ShortcutBinding settings contract.
 * [OUTPUT]: Provides product shortcut identities, defaults, override resolution.
 * [POS]: Shared shortcut truth consumed by renderer controls and native registration.
 */
import type { ShortcutBinding } from "../ipc/settings/settings-ipc";
export type ShortcutId = "search" | "newChat" | "settings" | "saveInstructions" | "findInFile" | "toggleSidebar" | "findInChat";
export type ShortcutOverrides = Readonly<Record<string, ShortcutBinding | null>>;
export const SHORTCUT_DEFAULTS: Readonly<Record<ShortcutId, ShortcutBinding>> = {
  search: { key: "k", shift: false },
  newChat: { key: "n", shift: false },
  settings: { key: ",", shift: false },
  saveInstructions: { key: "s", shift: false },
  findInFile: { key: "f", shift: false },
  toggleSidebar: { key: "b", shift: false },
  findInChat: { key: "f", shift: false },
};
export const SHORTCUT_IDS = Object.keys(SHORTCUT_DEFAULTS) as ShortcutId[];
export function resolveShortcut(id: ShortcutId, overrides: ShortcutOverrides): ShortcutBinding | null {
  return overrides[id] === undefined ? SHORTCUT_DEFAULTS[id] : overrides[id];
}
