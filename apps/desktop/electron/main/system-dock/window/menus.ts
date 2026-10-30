/**
 * [INPUT]: Depends on Electron Menu, localized catalog strings, and the DockService actions.
 * [OUTPUT]: Provides placement-fenced native menus, fixed Widget management destinations and host/native Quit last.
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
  const host = itemId ? service.allItems().find((entry) => entry.id === itemId && entry.host) : null;
  if (host) {
    template.push({ label: translate(service.ports.locale(), "systemDock.menu.open"),
      click: perform(() => service.ports.host?.open()) });
  } else if (running) {
    template.push({ label: translate(service.ports.locale(), "systemDock.menu.open"), click: perform(() => import("../intents").then(({ handleIntent }) => current() ? handleIntent(service, "bar", { kind: "activate", itemId: running.id }) : undefined)) });
  } else if (item) {
    template.push({ label: translate(service.ports.locale(), "systemDock.menu.open"), click: perform(() => import("../intents").then(({ handleIntent }) => current() ? handleIntent(service, "bar", { kind: "activate", itemId: item.id }) : undefined)) });
    if (item.kind === "system" && item.entry === "system.downloads")
      template.push({ label: translate(service.ports.locale(), "systemDock.menu.reveal"), click: perform(() => service.downloads.reveal()) });
  }
  if(item?.kind==='widget'&&service.ports.widgetEntry){
    const custom=item.widget.type==='custom',paused=custom&&service.ports.custom?.face(item,'bottom').state==='paused';
    const entry=(kind:'configure'|'edit'|'fork'|'versions'|'pause'|'remove',key:string)=>template.push({id:'dock-widget-'+kind,label:translate(service.ports.locale(),'systemDock.widgets.'+key),click:perform(()=>service.ports.widgetEntry?.({kind,itemId:item.id}))});
    template.push({type:'separator'});
    entry('configure','configure');
    if(custom){entry('edit','edit');entry('fork','copyCustomize');entry('versions','versions');entry('pause',paused?'resume':'pause');}
    else entry('fork','customize');
    entry('remove','remove');
  }
  const nativeTarget = running
    ? service.apps?.runningRegular().find((app) => `running-${app.pid}` === running.id)
    : item?.kind === "native-app" ? service.resolution.get(item.id) ?? { path: null, bundleIdentifier: item.bundleIdentifier } : null;
  const quitTarget = nativeTarget ? service.apps?.quitTarget(nativeTarget) : null;
  if (template.length) template.push({ type: "separator" });
  template.push({ label: translate(service.ports.locale(), "systemDock.menu.settings"), click: perform(() => service.ports.destination({ kind: "dock" })) });
  if (service.actualMode() === "replace") template.push({ type: "separator" }, { label: translate(service.ports.locale(), "systemDock.menu.restore"), click: perform(() => service.replacement?.suspend("user-restored")) });
  const quit = host ? () => service.ports.host?.quit() : quitTarget ? () => service.apps?.quit(quitTarget, current) : null;
  if (quit) template.push({ type: "separator" }, { id: "dock-quit", label: translate(service.ports.locale(), "systemDock.menu.quit"), click: perform(quit) });
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
    { label: translate(service.ports.locale(), "systemDock.menu.settings"), click: run(() => service.ports.destination({ kind: "dock" })) });
  return { label: translate(service.ports.locale(), "systemDock.menu.dock"), submenu };
}
