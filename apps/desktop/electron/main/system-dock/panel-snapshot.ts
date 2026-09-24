/**
 * [INPUT]: Depends on DockService facts (layout, drafts, entries, Usage adapter, Bottega Apps, native resolution) and the shared panel DTOs.
 * [OUTPUT]: Provides buildPanel (the single panel projection per view: detail for Downloads/Trash/Widgets, add candidates with four groups and search, edit/navigate item lists, undo and draft) and addCandidates (the key→draft table the add intent resolves against).
 * [POS]: system-dock panel projection; no side effects, privacy mask applied to values and file names (INV-06).
 */

import type { AddCandidate, PanelSnapshot, PanelView } from "../../../shared/system-dock/ipc";
import { defaultActivityWidget, defaultLimitsWidget, SYSTEM_ENTRIES, semanticKey, type DockItem, type DockItemDraft, type DockWidget } from "../../../shared/system-dock/layout";
import { entryLabel, maskFace } from "./projection";
import type { DockService } from "./service";

export type CandidateTable = { candidates: AddCandidate[]; drafts: Map<string, DockItemDraft> };

/** Keys are opaque and rebuilt per request; a stale key simply fails to resolve (INV-14). */
export function addCandidates(service: DockService): CandidateTable {
  const locale = service.ports.locale();
  const layout = service.ports.config.layout();
  const pinned = new Set(layout.items.map((item) => semanticKey(item)).filter(Boolean));
  const query = service.search.trim().toLocaleLowerCase();
  const table: CandidateTable = { candidates: [], drafts: new Map() };
  const push = (key: string, draft: DockItemDraft, candidate: Omit<AddCandidate, "key" | "pinned">) => {
    if (query && !candidate.label.toLocaleLowerCase().includes(query)) return;
    const semantic = semanticKey(draft);
    table.drafts.set(key, draft);
    table.candidates.push({ ...candidate, key, pinned: semantic !== null && pinned.has(semantic) });
  };
  const natives = new Map<string, { path: string | null; name: string }>();
  for (const app of service.apps?.installedApps() ?? []) if (app.bundleIdentifier && !natives.has(app.bundleIdentifier)) natives.set(app.bundleIdentifier, { path: app.path, name: app.name });
  for (const app of service.apps?.runningRegular() ?? []) if (app.bundleIdentifier && !natives.has(app.bundleIdentifier)) natives.set(app.bundleIdentifier, { path: app.path, name: app.name });
  // Finder is a system entry, never a second App tile (3.5).
  natives.delete("com.apple.finder");
  for (const [bundleIdentifier, app] of [...natives].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    push(`native:${bundleIdentifier}`, { kind: "native-app", platform: "darwin", bundleIdentifier, localApp: null, label: app.name },
      { kind: "native-app", label: app.name, iconKey: service.apps?.iconKey(app.path) ?? null, group: "native" });
  }
  for (const app of service.ports.apps.list()) {
    push(`bottega:${app.id}`, { kind: "bottega-app", appId: app.id, localApp: null, label: app.label },
      { kind: "bottega-app", label: app.label, iconKey: null, group: "bottega", ...(app.ready ? {} : { note: "unavailable" as const }) });
  }
  for (const entry of SYSTEM_ENTRIES) {
    const name = entry === "system.finder" ? "finder" : entry === "system.downloads" ? "downloads" : "trash";
    push(entry, { kind: "system", entry }, { kind: "system", label: entryLabel(locale, name), iconKey: null, group: "system" });
  }
  push("builtin.ai-limits", { kind: "widget", widget: defaultLimitsWidget(service.usage.defaultBackends()) },
    { kind: "widget", label: entryLabel(locale, "limits"), iconKey: null, group: "widget" });
  push("builtin.ai-activity", { kind: "widget", widget: defaultActivityWidget() },
    { kind: "widget", label: entryLabel(locale, "activity"), iconKey: null, group: "widget" });
  return table;
}
/** The panel's Usage consumer: the Widget detail it shows, as the draft while editing and the applied Widget otherwise. */
export function panelDemand(view: PanelView | null, item: (id: string) => DockItem | undefined, drafts: ReadonlyMap<string, DockWidget>) {
  const shown = view?.kind === "detail" ? item(view.itemId) : undefined;
  return shown?.kind === "widget" ? [{ itemId: shown.id, widget: drafts.get(shown.id) ?? shown.widget }] : [];
}
export function buildPanel(service: DockService): PanelSnapshot {
  const state = service.ports.local.get();
  const current = service.panel.current();
  const view = current.state === "visible" ? current.request?.view ?? null : null;
  const items = service.allItems();
  const base: PanelSnapshot = { revision: service.revision, locale: service.ports.locale(), view, focused: current.focused,
    mode: service.actualMode() ?? state.preferredMode, solidBackground: service.solidBackground, privacyMask: state.privacyMask, items,
    downloads: null, trash: null, limits: null, activity: null, candidates: null, undo: service.undo ? { label: service.undo.label } : null, draft: null };
  if (!view) return base;
  if (view.kind === "add") return { ...base, candidates: addCandidates(service).candidates };
  if (view.kind !== "detail") return base;
  const item = service.layoutItem(view.itemId);
  if (!item) return base;
  if (item.kind === "system" && item.entry === "system.downloads") {
    const detail = service.downloads.snapshot();
    return { ...base, downloads: state.privacyMask ? { ...detail, entries: detail.entries.map((entry) => ({ ...entry, name: "••••" })) } : detail };
  }
  if (item.kind === "system" && item.entry === "system.trash") return { ...base, trash: service.trash?.snapshot() ?? { state: "unknown", emptying: false, automation: "unavailable", lastResult: "none" } };
  if (item.kind !== "widget") return base;
  const draft: DockWidget = service.drafts.get(item.id) ?? item.widget;
  const withDraft = { ...base, draft: service.drafts.has(item.id) ? { itemId: item.id, widget: draft, stale: service.staleDrafts.has(item.id) } : null };
  if (draft.type === "builtin.ai-limits") {
    const detail = service.usage.limitsDetail(item.id, draft);
    return { ...withDraft, limits: state.privacyMask ? { ...detail, agents: detail.agents.map((agent) => ({ ...agent, pools: [], planLabel: null })) } : detail };
  }
  const detail = service.usage.activityDetail(item.id, draft);
  return { ...withDraft, activity: state.privacyMask ? { ...detail, face: maskFace(detail.face) as typeof detail.face } : detail };
}
