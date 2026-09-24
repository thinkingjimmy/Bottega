/**
 * [INPUT]: Depends on DockService facts and effects, the shared placement kernel, the add-candidate table, and Electron dialog/Menu for the two native affordances.
 * [OUTPUT]: Provides handleIntent: the single dispatcher for validated bar/panel intents — hover, activation (native/Bottega App, running item, Finder, detail toggle), context menu, panel navigation, Downloads/Trash actions, add/remove/undo/move/pin, Widget draft/apply (refused as stale when the applied Widget changed since the draft began, unless forced)/cancel/refresh, full Usage and Settings destinations, and system Dock restore.
 * [POS]: system-dock intent boundary; every layout edit commits once through DockConfigStore.edit, and no intent can reach a path, shell, AX or Apple Event beyond the fixed adapters (INV-13/14).
 */

import { dialog } from "electron";
import { randomUUID } from "node:crypto";
import { translate } from "../../../shared/i18n/runtime";
import { agentBackendIdSchema } from "../../../shared/agent-schema";
import type { DockIntent } from "../../../shared/system-dock/ipc";
import type { DockItemDraft } from "../../../shared/system-dock/layout";
import { addItem, moveItem, removeItem, undoRemove, updateItem } from "../../../shared/system-dock/placement";
import { addCandidates } from "./panel-snapshot";
import type { DockService } from "./service";
import type { DockRole } from "./window/surface";

export async function handleIntent(service: DockService, role: DockRole, intent: DockIntent): Promise<void> {
  // Acting inside a read-only panel turns it into an interactive one; blur then closes it (INV-09).
  if (role === "panel" && intent.kind !== "hover" && intent.kind !== "close-panel") service.panel.focus();
  switch (intent.kind) {
    case "hover": service.hover(role, intent.inside); return;
    case "activate": return activate(service, role, intent.itemId);
    case "context-menu": {
      const menu = service.ports.menus.item(service, intent.itemId);
      const window = service.barWindow();
      if (menu) menu.popup(window ? { window } : {});
      return;
    }
    case "open-panel": {
      const focus = intent.view.kind !== "detail" || role === "panel";
      return service.openPanel({ view: intent.view, focus, anchor: intent.view.kind === "detail" ? intent.view.itemId : null });
    }
    case "close-panel": service.closePanel(intent.restoreFocus); return;
    case "open-download": { if (await service.downloads.open(intent.ref) === "opened") service.closePanel(false); return; }
    case "reveal-downloads": await service.downloads.reveal(); service.closePanel(false); return;
    case "open-finder": await service.native?.request({ op: "finder-activate" }).catch(() => undefined); service.closePanel(false); return;
    case "empty-trash": await service.trash?.empty(); return;
    case "request-automation": await service.trash?.preflight(true); return;
    case "search": service.search = intent.query; service.schedule(); return;
    case "add": {
      const draft = addCandidates(service).drafts.get(intent.key);
      if (draft) await commitAdd(service, draft, null);
      return;
    }
    case "add-app-file": return addFromFile(service);
    case "remove": {
      let label = "";
      await service.ports.config.edit((layout) => {
        const result = removeItem(layout, intent.itemId);
        if ("failure" in result) return layout;
        label = service.allItems().find((item) => item.id === intent.itemId)?.label ?? "";
        service.undo = { token: result.undo, label };
        return result.layout;
      });
      service.dropDraft(intent.itemId);
      return;
    }
    case "undo": {
      const undo = service.undo;
      if (!undo) return;
      service.undo = null;
      let added: string | null = null;
      await service.ports.config.edit((layout) => { const result = undoRemove(layout, undo.token); if ("failure" in result) return layout; added = result.itemId; return result.layout; });
      if (added) service.highlight(added);
      return;
    }
    case "move": {
      const itemId = service.aliases.get(intent.itemId) ?? intent.itemId;
      await service.ports.config.edit((layout) => { const result = moveItem(layout, itemId, intent.index); return "failure" in result ? layout : result; });
      return;
    }
    case "pin-running": {
      const app = runningApp(service, intent.itemId);
      if (!app?.bundleIdentifier) return;
      const itemId = await commitAdd(service, { kind: "native-app", platform: "darwin", bundleIdentifier: app.bundleIdentifier, localApp: null, label: app.name }, null);
      if (itemId) { service.aliases.set(intent.itemId, itemId); setTimeout(() => service.aliases.delete(intent.itemId), 5_000).unref?.(); }
      return;
    }
    case "widget-draft": {
      const item = service.layoutItem(intent.itemId);
      if (item?.kind !== "widget" || item.widget.type !== intent.widget.type) return;
      if (!service.draftBases.has(intent.itemId)) service.draftBases.set(intent.itemId, canonical(intent.base ?? item.widget));
      service.drafts.set(intent.itemId, intent.widget);
      service.usage.setVisible("dock-panel", [{ itemId: intent.itemId, widget: intent.widget }]);
      service.schedule();
      return;
    }
    case "widget-apply": {
      const draft = service.drafts.get(intent.itemId);
      if (!draft) return;
      let stale = false;
      await service.ports.config.edit((layout) => {
        const current = layout.items.find((item) => item.id === intent.itemId);
        // Checked inside the store's serialized edit: a sync adoption between check and write cannot slip past (3.4).
        if (!intent.force && current?.kind === "widget" && canonical(current.widget) !== service.draftBases.get(intent.itemId)) { stale = true; return layout; }
        const result = updateItem(layout, intent.itemId, (item) => item.kind === "widget" ? { ...item, widget: draft } : item); return "failure" in result ? layout : result;
      });
      if (stale) { service.staleDrafts.add(intent.itemId); service.schedule(); return; }
      service.dropDraft(intent.itemId);
      service.refreshPanelDemand();
      return;
    }
    case "widget-cancel": service.dropDraft(intent.itemId); service.refreshPanelDemand(); service.schedule(); return;
    case "refresh-usage": {
      const item = service.layoutItem(intent.itemId);
      if (item?.kind === "widget") await service.usage.refresh(service.drafts.get(item.id) ?? item.widget);
      return;
    }
    case "open-full-usage": {
      const agent = intent.backend ? agentBackendIdSchema.safeParse(intent.backend) : null;
      service.closePanel(false);
      return service.ports.destination({ kind: "usage", agent: agent?.success ? agent.data : null });
    }
    case "open-settings": service.closePanel(false); return service.ports.destination({ kind: "dock" });
    case "restore-system-dock": service.closePanel(false); await service.replacement?.suspend("user-restored"); return;
  }
}
/** Key-order-independent JSON, so a base echoed by the renderer compares equal to the stored Widget. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : entry);
}
function runningApp(service: DockService, itemId: string) {
  const match = /^running-(\d+)$/.exec(itemId);
  return match ? service.apps?.runningRegular().find((app) => app.pid === Number(match[1])) ?? null : null;
}
async function activate(service: DockService, role: DockRole, itemId: string) {
  const running = runningApp(service, itemId);
  if (running) {
    if (running.path) await service.apps?.launch({ path: running.path, bundleIdentifier: running.bundleIdentifier }, service.settingsSnapshot().accessibility === "granted");
    if (role === "panel") service.closePanel(false);
    return;
  }
  const item = service.layoutItem(itemId);
  if (!item) return;
  if (item.kind === "native-app") {
    const resolved = service.resolution.get(item.id);
    // A missing App keeps its placeholder; the edit view offers repair instead of a silent no-op.
    if (!resolved) { await service.openPanel({ view: { kind: "edit" }, focus: true, anchor: null }); return; }
    const outcome = await service.apps?.launch(resolved, service.settingsSnapshot().accessibility === "granted");
    if (outcome?.status === "missing") { service.resolution.set(item.id, null); service.apps?.invalidate(); service.schedule(); }
    if (role === "panel") service.closePanel(false);
    return;
  }
  if (item.kind === "bottega-app") {
    if (item.appId) await service.ports.apps.open(item.appId);
    if (role === "panel") service.closePanel(false);
    return;
  }
  if (item.kind === "system" && item.entry === "system.finder") {
    await service.native?.request({ op: "finder-activate" }).catch(() => undefined);
    if (role === "panel") service.closePanel(false);
    return;
  }
  // Downloads, Trash and Widgets open their detail; clicking the served item again closes it (3.4).
  if (service.panelTargetItem() === item.id) { service.closePanel(false); return; }
  await service.openPanel({ view: { kind: "detail", itemId: item.id }, focus: role === "panel", anchor: item.id });
}
async function commitAdd(service: DockService, draft: DockItemDraft, binding: { path: string; bundleIdentifier: string | null } | null): Promise<string | null> {
  let itemId: string | null = null;
  const record = await service.ports.config.edit((layout) => {
    const result = addItem(layout, draft);
    if ("failure" in result) return layout;
    itemId = result.itemId;
    return result.layout;
  });
  if (!itemId) return null;
  if (binding) await service.ports.local.update((state) => ({ ...state, nativeBindings: { ...state.nativeBindings, [itemId!]: binding } }));
  if (record.layout.items.some((item) => item.id === itemId)) {
    service.closePanel(false);
    await service.resolveAll();
    service.highlight(itemId);
  }
  return itemId;
}
/** The dedicated .app picker: the only file-based add path, bound to this installation (3.3, INV-05). */
async function addFromFile(service: DockService) {
  const locale = service.ports.locale();
  const result = await dialog.showOpenDialog({ title: translate(locale, "systemDock.dialog.chooseAppTitle"), buttonLabel: translate(locale, "systemDock.menu.chooseAppButton"),
    defaultPath: "/Applications", properties: ["openFile"], filters: [{ name: translate(locale, "systemDock.dialog.applicationsFilter"), extensions: ["app"] }] });
  const path = result.canceled ? null : result.filePaths[0];
  if (!path || !path.endsWith(".app")) return;
  const resolved = await service.apps?.resolve({ path });
  if (!resolved) return;
  const draft: DockItemDraft = resolved.bundleIdentifier
    ? { kind: "native-app", platform: "darwin", bundleIdentifier: resolved.bundleIdentifier, localApp: null, label: resolved.name }
    : { kind: "native-app", platform: "darwin", bundleIdentifier: null, localApp: { originInstallationId: service.ports.installation, localRef: randomUUID() }, label: resolved.name };
  // Several copies of one bundle ID: keep the exact copy the user picked on this Mac.
  const bindingNeeded = !resolved.bundleIdentifier || resolved.copies.length > 1;
  await commitAdd(service, draft, bindingNeeded ? { path: resolved.path, bundleIdentifier: resolved.bundleIdentifier } : null);
}
