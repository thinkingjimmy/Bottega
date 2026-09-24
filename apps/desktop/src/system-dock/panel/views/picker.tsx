/**
 * [INPUT]: Depends on the panel context (candidates, focus mode, Escape layers), the common glyph cache, and lucide affordance glyphs.
 * [OUTPUT]: Provides `PickerView`: a debounced query sent to main, four candidate groups (Mac Apps, Bottega Apps, system items, Widgets) with In Dock / unavailable / needs-repair notes, arrow-key movement from the field into the rows, and a dedicated "Choose an App…" file picker.
 * [POS]: system-dock/panel add view (3.3, DCK-11); main filters, inserts at the semantic default position, and closes or highlights on success — this view only renders what the snapshot says.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { FolderSearch } from "lucide-react";
import type { AddCandidate } from "../../../../shared/system-dock/ipc";
import type { SystemEntryId } from "../../../../shared/system-dock/layout";
import { DockGlyph, useDockIcons } from "../../common/icons";
import { useEscapeLayer, usePanel } from "../context";

export const QUERY_DEBOUNCE_MS = 150;
const GROUP_KEYS = { native: "systemDock.add.groupNative", bottega: "systemDock.add.groupBottega", system: "systemDock.add.groupSystem", widget: "systemDock.add.groupWidgets" } as const;
const GROUP_ORDER = ["native", "bottega", "system", "widget"] as const;

export function PickerView() {
  const { snapshot, t, send, focused } = usePanel();
  const [query, setQuery] = useState("");
  const sent = useRef("");
  const listRef = useRef<HTMLDivElement>(null);
  const candidates = snapshot.candidates;
  const icons = useDockIcons(candidates?.map((candidate) => candidate.iconKey) ?? []);
  useEffect(() => {
    if (query === sent.current) return;
    const timer = window.setTimeout(() => { sent.current = query; send({ kind: "search", query }); }, QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, send]);
  // Escape first clears a typed query, then leaves the view.
  useEscapeLayer(query !== "", () => setQuery(""));
  const rows = () => [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-candidate]") ?? [])];
  const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = rows();
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) { if (event.key === "ArrowDown") buttons[0]!.focus(); return; }
    const next = index + (event.key === "ArrowDown" ? 1 : -1);
    if (next < 0) document.getElementById("dock-add-query")?.focus(); else buttons[Math.min(buttons.length - 1, next)]!.focus();
  };
  const note = (candidate: AddCandidate) => candidate.pinned ? t("systemDock.add.inDock")
    : candidate.note === "unavailable" ? t("systemDock.item.unavailable") : candidate.note === "needs-repair" ? t("systemDock.item.needsRepair") : null;
  return <>
    <div className="field-row">
      <label className="visually-hidden" htmlFor="dock-add-query">{t("systemDock.add.queryLabel")}</label>
      {/* Autofocus only once the user is in the panel; a hover-opened panel stays read-only (INV-09). */}
      <input id="dock-add-query" type="search" className="field" value={query} autoComplete="off" spellCheck={false}
        placeholder={t("systemDock.add.queryPlaceholder")} data-autofocus={focused || undefined}
        onChange={(event) => setQuery(event.target.value)} onKeyDown={moveFocus} />
    </div>
    <div className="scroll" ref={listRef} onKeyDown={moveFocus}>
      {candidates === null ? <p className="empty-state" role="status">{t("systemDock.add.loading")}</p>
        : candidates.length === 0 ? <p className="empty-state" role="status">{query ? t("systemDock.add.noMatches", { query }) : t("systemDock.add.nothing")}</p>
          : GROUP_ORDER.map((group) => {
            const members = candidates.filter((candidate) => candidate.group === group);
            if (!members.length) return null;
            return <section key={group} className="group" aria-labelledby={`dock-add-${group}`}>
              <h2 id={`dock-add-${group}`} className="group-label">{t(GROUP_KEYS[group])}</h2>
              {members.map((candidate, index) => <button key={candidate.key} type="button" className="row" data-candidate={candidate.key}
                data-pinned={candidate.pinned || undefined} aria-describedby={note(candidate) ? `dock-note-${group}-${index}` : undefined}
                onClick={() => send({ kind: "add", key: candidate.key })}>
                <span className="row-glyph"><DockGlyph subject={{ kind: candidate.kind, iconKey: candidate.iconKey,
                  // Candidate keys for system entries and Widgets are their semantic identities (system.*, builtin.*).
                  entry: candidate.kind === "system" ? candidate.key as SystemEntryId : undefined,
                  widgetType: candidate.kind === "widget" ? candidate.key : undefined }} icons={icons} /></span>
                <span className="row-text"><span className="row-title">{candidate.label}</span></span>
                {note(candidate) && <span className="row-note" id={`dock-note-${group}-${index}`} data-tone={candidate.note ? "caution" : undefined}>{note(candidate)}</span>}
              </button>)}
            </section>;
          })}
    </div>
    <footer className="panel-footer">
      <button type="button" className="text-button" onClick={() => send({ kind: "add-app-file" })}><FolderSearch aria-hidden="true" />{t("systemDock.add.chooseApp")}</button>
    </footer>
  </>;
}
