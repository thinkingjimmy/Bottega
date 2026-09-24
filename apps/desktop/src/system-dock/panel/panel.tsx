/**
 * [INPUT]: Depends on the isolated Dock bridge adapter, the panel context, the common translator, and every panel view.
 * [OUTPUT]: Provides `DockPanel`: header with back/close, the view switch (detail, add, edit, navigate), layered Escape (nested step → keyboard list → close with focus restore), activation-aware initial focus, pointer presence, and one polite live region.
 * [POS]: system-dock/panel root composed by main.tsx; main owns panel visibility, activation and blur-to-close, so a null view renders nothing (the hidden-ready prewarm state, 5.2).
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, X } from "lucide-react";
import type { DockIntent, PanelView } from "../../../shared/system-dock/ipc";
import { isPanelSnapshot, sendIntent, useDockSnapshot, useHoverIntent, useNow } from "../common/bridge";
import { dockTranslator } from "../common/format";
import { PanelContext, type PanelApi, type PanelSnapshotView } from "./context";
import { ArrangeView } from "./views/arrange";
import { DetailView } from "./views/detail";
import { NavigateView } from "./views/navigate";
import { PickerView } from "./views/picker";

const viewKey = (view: PanelView) => view.kind === "detail" ? `detail:${view.itemId}` : view.kind;

function focusFirst(root: HTMLElement | null) {
  if (!root) return;
  const target = root.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)")
    ?? root.querySelector<HTMLElement>(".panel-body button:not(:disabled), .panel-body [tabindex='0'], .panel-body input, .panel-body select");
  target?.focus({ preventScroll: true });
}

export function DockPanel() {
  const snapshot = useDockSnapshot(isPanelSnapshot) as PanelSnapshotView | null;
  useHoverIntent();
  const now = useNow();
  const [announcement, setAnnouncement] = useState("");
  const [backTo, setBackTo] = useState<string | null>(null);
  const escapeLayers = useRef<(() => boolean)[]>([]);
  const rootRef = useRef<HTMLElement>(null);
  const key = snapshot?.view ? viewKey(snapshot.view) : null;
  const focused = Boolean(snapshot?.focused);

  // The back target only survives while the detail it was recorded for is on screen.
  const [seenKey, setSeenKey] = useState(key);
  if (key !== seenKey) { setSeenKey(key); if (key === null || key === "navigate" || key === "add" || key === "edit") setBackTo(null); }
  useEffect(() => {
    if (!key || !focused) return;
    /* Initial focus waits for native activation: a hover-opened, read-only panel must not take
       the keyboard from the app the user is in (INV-09). */
    const place = () => { if (document.hasFocus() && !rootRef.current?.contains(document.activeElement)) focusFirst(rootRef.current); };
    const frame = requestAnimationFrame(place);
    window.addEventListener("focus", place);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("focus", place); };
  }, [key, focused]);

  const api = useMemo<PanelApi | null>(() => {
    if (!snapshot) return null;
    const send = (intent: DockIntent) => void sendIntent(intent);
    return { snapshot, t: dockTranslator(snapshot.locale), now, mask: snapshot.privacyMask, send, focused: snapshot.focused, escapeLayers,
      announce: (text) => { setAnnouncement(""); requestAnimationFrame(() => setAnnouncement(text)); },
      rememberReturn: (itemId) => setBackTo(`detail:${itemId}`),
      openDetail: (itemId) => { setBackTo(`detail:${itemId}`); send({ kind: "open-panel", view: { kind: "detail", itemId } }); } };
  }, [snapshot, now]);
  if (!snapshot || !snapshot.view || !api) return null;
  const { send } = api;
  const t = dockTranslator(snapshot.locale);
  const view = snapshot.view;
  const canGoBack = backTo === key;
  const back = () => { setBackTo(null); send({ kind: "open-panel", view: { kind: "navigate" } }); };
  const close = () => send({ kind: "close-panel", restoreFocus: true });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    const layer = escapeLayers.current.at(-1);
    if (layer?.()) return;
    if (canGoBack) back(); else close();
  };
  const item = view.kind === "detail" ? snapshot.items.find((value) => value.id === view.itemId) : undefined;
  const title = view.kind === "add" ? t("systemDock.add.title") : view.kind === "edit" ? t("systemDock.edit.title")
    : view.kind === "navigate" ? t("systemDock.navigate.title") : item?.label ?? t("systemDock.panel.title");
  return <PanelContext.Provider value={api}>
    <section ref={rootRef} className="panel" aria-labelledby="dock-panel-title" data-view={view.kind} onKeyDown={onKeyDown}>
      <header className="panel-header">
        {canGoBack && <button type="button" className="icon-button" aria-label={t("systemDock.panel.back")} title={t("systemDock.panel.back")} onClick={back}>
          <ArrowLeft aria-hidden="true" /></button>}
        <h1 id="dock-panel-title">{title}</h1>
        <button type="button" className="icon-button" aria-label={t("systemDock.panel.close")} title={t("systemDock.panel.close")} onClick={close}>
          <X aria-hidden="true" /></button>
      </header>
      <div className="panel-body" key={key}>
        {view.kind === "navigate" ? <NavigateView /> : view.kind === "add" ? <PickerView /> : view.kind === "edit" ? <ArrangeView />
          : <DetailView itemId={view.itemId} />}
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
    </section>
  </PanelContext.Provider>;
}
