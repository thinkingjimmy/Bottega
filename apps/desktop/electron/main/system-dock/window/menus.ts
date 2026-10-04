/**
 * [INPUT]: Depends on Electron Menu, localized catalog strings, and the DockService actions.
 * [OUTPUT]: Provides the placement-fenced bar context menu (per item: open, keep/remove, show in Finder for Downloads; always: edit, settings, restore) and the Presence "Dock ▸" submenu (show/hide, restore, add, edit, settings).
 * [POS]: system-dock native menus; restore stays reachable from both the Dock itself and the menu bar (3.1), independent of the bar renderer's health.
 */

import { Menu, type MenuItemConstructorOptions } from "electron";
import { translate } from "../../../../shared/i18n/runtime";
import type { DockService } from "../service";

function run(task: () => unknown) { return () => { void Promise.resolve().then(task).catch((cause) => console.warn("[system-dock] menu action failed", cause)); }; }

export function itemMenu(service: DockService, itemId: string | null): Menu | null {
  const current = service.captureInteraction();
  const perform = (task: () => unknown) => run(() => current() ? task() : undefined);
  const template: MenuItemConstructorOptions[] = [];
  const running = itemId?.startsWith("running-") ? service.allItems().find((item) => item.id === itemId) : undefined;
  const item = itemId && !running ? service.layoutItem(itemId) : undefined;
  if (running) {
    template.push({ label: translate(service.ports.locale(), "systemDock.menu.open"), click: perform(() => import("../intents").then(({ handleIntent }) => current() ? handleIntent(service, "bar", { kind: "activate", itemId: running.id }) : undefined)) },
      { label: translate(service.ports.locale(), "systemDock.menu.keep"), click: perform(() => import("../intents").then(({ handleIntent }) => current() ? handleIntent(service, "bar", { kind: "pin-running", itemId: running.id }) : undefined)) });
  } else if (item) {
    template.push({ label: translate(service.ports.locale(), "systemDock.menu.open"), click: perform(() => import("../intents").then(({ handleIntent }) => current() ? handleIntent(service, "bar", { kind: "activate", itemId: item.id }) : undefined)) });
    if (item.kind === "system" && item.entry === "system.downloads")
      template.push({ label: translate(service.ports.locale(), "systemDock.menu.reveal"), click: perform(() => service.downloads.reveal()) });
    template.push({ label: translate(service.ports.locale(), "systemDock.menu.remove"), click: perform(() => import("../intents").then(({ handleIntent }) => current() ? handleIntent(service, "bar", { kind: "remove", itemId: item.id }) : undefined)) });
  }
  if (template.length) template.push({ type: "separator" });
  template.push({ label: translate(service.ports.locale(), "systemDock.menu.add"), click: perform(() => service.openPanel({ view: { kind: "add" }, focus: true, anchor: null })) },
    { label: translate(service.ports.locale(), "systemDock.menu.edit"), click: perform(() => service.openPanel({ view: { kind: "edit" }, focus: true, anchor: null })) },
    { label: translate(service.ports.locale(), "systemDock.menu.settings"), click: perform(() => service.ports.destination({ kind: "dock" })) });
  if (service.actualMode() === "replace") template.push({ type: "separator" }, { label: translate(service.ports.locale(), "systemDock.menu.restore"), click: perform(() => service.replacement?.suspend("user-restored")) });
  return Menu.buildFromTemplate(template);
}
/** Presence submenu; `null` hides it entirely when the Dock is unsupported or off. */
export function presenceSubmenu(service: DockService): MenuItemConstructorOptions | null {
  if (!service.capability.supported || !service.initialized || !service.ports.local.get().enabled) return null;
  const submenu: MenuItemConstructorOptions[] = [
    service.temporarilyHidden
      ? { label: translate(service.ports.locale(), "systemDock.menu.showAgain"), click: run(() => service.setTemporarilyHidden(false)) }
      : { label: translate(service.ports.locale(), "systemDock.menu.temporarilyHide"), enabled: service.started, click: run(() => service.setTemporarilyHidden(true)) },
  ];
  const phase = service.replacement?.status().phase;
  const restoreFailed = service.replacement?.status().lastResult === "failed";
  if (service.actualMode() === "replace" || phase === "suspended") submenu.push({ label: translate(service.ports.locale(), "systemDock.menu.restore"), enabled: phase === "active" || phase === "preparing" || restoreFailed,
    click: run(() => service.replacement?.suspend("user-restored")) });
  submenu.push({ type: "separator" },
    { label: translate(service.ports.locale(), "systemDock.menu.add"), enabled: service.started, click: run(() => service.openPanel({ view: { kind: "add" }, focus: true, anchor: null })) },
    { label: translate(service.ports.locale(), "systemDock.menu.edit"), enabled: service.started, click: run(() => service.openPanel({ view: { kind: "edit" }, focus: true, anchor: null })) },
    { label: translate(service.ports.locale(), "systemDock.menu.settings"), click: run(() => service.ports.destination({ kind: "dock" })) });
  return { label: translate(service.ports.locale(), "systemDock.menu.dock"), submenu };
}
