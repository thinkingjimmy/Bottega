/**
 * [INPUT]: Depends on the panel context (items, undo token, optional mode), the sortable list, the common glyph cache, and lucide action glyphs.
 * [OUTPUT]: Provides `ArrangeView`: the pinned order as a reorderable list (drag commits once on drop; Move up/down by keyboard), per-item Remove with the snapshot's Undo notice, the Dock settings exit, and Restore system Dock in replace mode.
 * [POS]: system-dock/panel edit view (DCK-10, DCK-37); removing only unpins — it never quits, uninstalls or empties anything (INV-07).
 */

import { useEffect, useEffectEvent, useRef } from "react";
import { Plus, RotateCcw, Settings2, X } from "lucide-react";
import { DockGlyph, useDockIcons } from "../../common/icons";
import { usePanel } from "../context";
import { SortableList } from "../sortable";

export function ArrangeView() {
  const { snapshot, t, send } = usePanel();
  const pinned = snapshot.items.filter((item) => item.pinned);
  const icons = useDockIcons(pinned.map((item) => item.iconKey));
  const rows = pinned.map((item) => ({ id: item.id, name: item.label, item }));
  /* The removed row takes its focused button with it; keep the keyboard in the list by moving
     to the row that slid into its place (or the one above, or Undo). */
  const removedAt = useRef<number | null>(null);
  const refocus = useEffectEvent(() => {
    const index = removedAt.current;
    if (index === null || rows.some((row) => row.id === document.activeElement?.closest<HTMLElement>("[data-row]")?.dataset.row)) return;
    removedAt.current = null;
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button[data-remove]")];
    (buttons[index] ?? buttons.at(-1) ?? document.querySelector<HTMLButtonElement>("button[data-undo]"))?.focus();
  });
  useEffect(() => { refocus(); }, [rows.length]);
  return <>
    <div className="scroll">
      {rows.length === 0 ? <div className="empty-state">
        <p>{t("systemDock.edit.empty")}</p>
        <button type="button" className="text-button" onClick={() => send({ kind: "open-panel", view: { kind: "add" } })}><Plus aria-hidden="true" />{t("systemDock.navigate.add")}</button>
      </div> : <SortableList rows={rows} label={t("systemDock.edit.listLabel")} onMove={(itemId, index) => send({ kind: "move", itemId, index })}
        render={({ item }, controls) => <div className="row static" data-status={item.status}>
          <span className="row-glyph"><DockGlyph subject={{ kind: item.kind, iconKey: item.iconKey, entry: item.entry, trash: item.trash, widgetType: item.widget?.type }} icons={icons} /></span>
          <span className="row-text"><span className="row-title">{item.label}</span></span>
          <span className="row-actions">{controls}
            <button type="button" className="icon-button small" data-remove aria-label={t("systemDock.edit.remove", { name: item.label })} title={t("systemDock.edit.remove", { name: item.label })}
              onClick={() => { removedAt.current = pinned.indexOf(item); send({ kind: "remove", itemId: item.id }); }}>
              <X aria-hidden="true" /></button>
          </span>
        </div>} />}
    </div>
    {/* The notice itself is the live announcement of the removal. */}
    {snapshot.undo && <div className="notice" role="status">
      <span>{t("systemDock.edit.removed", { name: snapshot.undo.label })}</span>
      <button type="button" className="text-button" data-undo onClick={() => send({ kind: "undo" })}>{t("systemDock.edit.undo")}</button>
    </div>}
    <footer className="panel-footer">
      <button type="button" className="text-button" onClick={() => send({ kind: "open-settings" })}><Settings2 aria-hidden="true" />{t("systemDock.edit.settings")}</button>
      {snapshot.mode === "replace" && <button type="button" className="text-button" onClick={() => send({ kind: "restore-system-dock" })}>
        <RotateCcw aria-hidden="true" />{t("systemDock.edit.restore")}</button>}
    </footer>
  </>;
}
