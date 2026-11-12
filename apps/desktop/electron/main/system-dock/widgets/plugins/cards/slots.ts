/**
 * [INPUT]: Eligible Widget IDs in display order per trusted window and current privacy state.
 * [OUTPUT]: Ordered Dock-frame reservations including in-flight opens, with a fixed global ceiling.
 * [POS]: Shared by the Dock bar, current detail and every catalog window.
 */
import { DOCK_LAYOUT_BUDGET } from "../../../../../../shared/system-dock/layout";

export const DOCK_WIDGET_FRAMES = Math.min(2 * DOCK_LAYOUT_BUDGET.items + 1, 12);
export type WidgetCardRole = "bar" | "panel" | "catalog";
type WindowCards = { role: WidgetCardRole; windowId: number; ids: readonly string[] };
const priorities = { panel: 0, bar: 1, catalog: 2 };
const key = (windowId: number, itemId: string) => `${windowId}/${itemId}`;

export class DockCardSlots {
  private readonly windows = new Map<number, WindowCards>();
  private allowed = new Set<string>();

  set(role: WidgetCardRole, windowId: number, ids: readonly string[]) {
    if (ids.length) this.windows.set(windowId, { role, windowId, ids });
    else this.windows.delete(windowId);
  }

  plan(eligible: (itemId: string) => boolean) {
    const next = new Set<string>();
    const windows = [...this.windows.values()].sort((a, b) => priorities[a.role] - priorities[b.role]);
    for (const window of windows) {
      for (const id of window.ids) {
        if (eligible(id)) next.add(key(window.windowId, id));
        if (next.size === DOCK_WIDGET_FRAMES) break;
      }
      if (next.size === DOCK_WIDGET_FRAMES) break;
    }
    const changed = next.size !== this.allowed.size || [...next].some(value => !this.allowed.has(value));
    this.allowed = next;
    return changed;
  }

  allows(windowId: number, itemId: string) { return this.allowed.has(key(windowId, itemId)); }
  forWindow(windowId: number) { return (this.windows.get(windowId)?.ids ?? []).filter(id => this.allows(windowId, id)); }
  close() { this.windows.clear(); this.allowed.clear(); }
}
