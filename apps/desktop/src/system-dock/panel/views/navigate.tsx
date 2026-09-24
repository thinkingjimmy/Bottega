/**
 * [INPUT]: Depends on the panel context, the common item name/detail policy and glyph cache, and lucide affordance glyphs.
 * [OUTPUT]: Provides `NavigateView`: every Dock item (pinned, then open Apps) as one grouped listbox with arrow/J/K/Home/End movement, Enter to activate, Space/→ to open a detail, Shift+F10 for the item menu, plus Add and Edit exits.
 * [POS]: system-dock/panel keyboard entry and overflow destination (DCK-36); the equivalent of every bar gesture without a pointer (INV-09).
 */

import { useState, type KeyboardEvent } from "react";
import { ChevronRight, Pencil, Plus } from "lucide-react";
import type { DockBarItem } from "../../../../shared/system-dock/ipc";
import { dockItemName, hasDetail } from "../../common/format";
import { DockGlyph, useDockIcons } from "../../common/icons";
import { usePanel } from "../context";

export function NavigateView() {
  const { snapshot, t, mask, now, send, openDetail, rememberReturn } = usePanel();
  const pinned = snapshot.items.filter((item) => item.pinned);
  const running = snapshot.items.filter((item) => !item.pinned);
  // Keyboard order follows the rendered groups, whatever order main listed them in.
  const items = [...pinned, ...running];
  const icons = useDockIcons(items.map((item) => item.iconKey));
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = items.find((item) => item.id === activeId) ?? items[0];
  const activate = (item: DockBarItem) => {
    // Main decides what activation means; a detail it opens should lead back here on Escape.
    if (hasDetail(item)) rememberReturn(item.id);
    send({ kind: "activate", itemId: item.id });
  };
  const focusOption = (item: DockBarItem | undefined) => {
    if (!item) return;
    setActiveId(item.id);
    document.getElementById(`dock-option-${item.id}`)?.scrollIntoView({ block: "nearest" });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!active || event.metaKey || event.altKey || event.ctrlKey) return;
    const index = items.indexOf(active);
    const key = event.key;
    if (key === "ArrowDown" || key === "j") { event.preventDefault(); focusOption(items[Math.min(items.length - 1, index + 1)]); }
    else if (key === "ArrowUp" || key === "k") { event.preventDefault(); focusOption(items[Math.max(0, index - 1)]); }
    else if (key === "Home") { event.preventDefault(); focusOption(items[0]); }
    else if (key === "End") { event.preventDefault(); focusOption(items.at(-1)); }
    else if (key === "Enter") { event.preventDefault(); activate(active); }
    else if ((key === " " || key === "ArrowRight") && hasDetail(active)) { event.preventDefault(); openDetail(active.id); }
    else if (key === "ContextMenu" || (key === "F10" && event.shiftKey)) { event.preventDefault(); send({ kind: "context-menu", itemId: active.id }); }
  };
  const option = (item: DockBarItem) => <div key={item.id} id={`dock-option-${item.id}`} role="option" className="row option"
    aria-selected={item.id === active?.id} aria-label={dockItemName(item, t, mask, now)} data-status={item.status}
    onPointerDown={(event) => event.preventDefault()} onClick={() => { setActiveId(item.id); activate(item); }}>
    <span className="row-glyph"><DockGlyph subject={{ kind: item.kind, iconKey: item.iconKey, entry: item.entry, trash: item.trash, widgetType: item.widget?.type }} icons={icons} /></span>
    <span className="row-text"><span className="row-title">{item.label}</span>
      {item.running && item.pinned && <span className="row-meta">{t("systemDock.item.running")}</span>}</span>
    {hasDetail(item) && <ChevronRight className="row-trailing" aria-hidden="true" />}
  </div>;
  return <>
    {items.length === 0 ? <p className="empty-state">{t("systemDock.navigate.empty")}</p>
      : <div className="listbox" role="listbox" tabIndex={0} data-autofocus aria-label={t("systemDock.navigate.title")}
        aria-activedescendant={active ? `dock-option-${active.id}` : undefined} onKeyDown={onKeyDown}>
        {pinned.length > 0 && <div role="group" aria-label={t("systemDock.navigate.pinned")}>{pinned.map(option)}</div>}
        {running.length > 0 && <div role="group" aria-label={t("systemDock.navigate.running")}>
          <p className="group-label" aria-hidden="true">{t("systemDock.navigate.running")}</p>{running.map(option)}</div>}
      </div>}
    <p className="hint" aria-hidden="true">{t("systemDock.navigate.hint")}</p>
    <footer className="panel-footer">
      <button type="button" className="text-button" onClick={() => send({ kind: "open-panel", view: { kind: "add" } })}><Plus aria-hidden="true" />{t("systemDock.navigate.add")}</button>
      <button type="button" className="text-button" onClick={() => send({ kind: "open-panel", view: { kind: "edit" } })}><Pencil aria-hidden="true" />{t("systemDock.navigate.edit")}</button>
    </footer>
  </>;
}
