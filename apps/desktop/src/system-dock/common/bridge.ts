/**
 * [INPUT]: Depends on React, the isolated `window.systemDock` bridge contract, the lazy locale catalog loader, and the renderer Intl locale snapshot.
 * [OUTPUT]: Provides the window typing, bar/panel snapshot guards, `useDockSnapshot` (revision-ordered, catalog-ready, locale synced), a coarse `useNow` clock, the fire-and-forget `sendIntent`, and `useHoverIntent` (edge-only window pointer presence).
 * [POS]: system-dock/common transport adapter shared by the bar and panel roots; the only file that touches `window.systemDock`'s snapshot stream.
 */

import { useEffect, useRef, useState } from "react";
import type { DockBarSnapshot, DockIntent, PanelSnapshot, SystemDockBridge } from "../../../shared/system-dock/ipc";
import { loadCatalog } from "../../../shared/i18n/catalogs";
import { setEffectiveLocale } from "../../lib/i18n-locale";

declare global { interface Window { systemDock?: SystemDockBridge } }

export const isBarSnapshot = (value: DockBarSnapshot | PanelSnapshot): value is DockBarSnapshot => "revealed" in value;
export const isPanelSnapshot = (value: DockBarSnapshot | PanelSnapshot): value is PanelSnapshot => "view" in value;

/**
 * Main pushes whole snapshots; an older revision arriving late (the initial invoke racing the
 * first push) must never overwrite a newer one. The catalog loads before the snapshot is shown
 * so the first painted frame is already in the user's language, never English then swapped.
 */
export function useDockSnapshot<T extends DockBarSnapshot | PanelSnapshot>(accept: (value: DockBarSnapshot | PanelSnapshot) => value is T): T | null {
  const [snapshot, setSnapshot] = useState<T | null>(null);
  useEffect(() => {
    let mounted = true;
    let revision = -1;
    let delivery = 0;
    const receive = async (value: DockBarSnapshot | PanelSnapshot) => {
      if (!accept(value) || value.revision < revision) return;
      revision = value.revision;
      const sequence = ++delivery;
      await loadCatalog(value.locale).catch(() => undefined);
      if (!mounted || sequence !== delivery) return;
      document.documentElement.lang = value.locale;
      document.documentElement.toggleAttribute("data-solid", Boolean(value.solidBackground));
      setEffectiveLocale(value.locale);
      setSnapshot(value);
    };
    const stop = window.systemDock?.onChanged((value) => void receive(value));
    void window.systemDock?.snapshot().then(receive).catch(() => undefined);
    return () => { mounted = false; stop?.(); };
  }, [accept]);
  return snapshot;
}

/** A coarse clock for relative times and reset countdowns; faces never need sub-minute precision. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Intents are commands to main; main answers with a new snapshot, so the renderer never awaits a result to render. */
export function sendIntent(intent: DockIntent): Promise<boolean> {
  return window.systemDock?.intent(intent).then(() => true, () => false) ?? Promise.resolve(false);
}

/**
 * Both surfaces report pointer presence over their whole window: main keeps bar and panel open
 * while the pointer is over either and owns every reveal/collapse delay (3.2). Only edges are
 * sent; `hold` suppresses a leave while a drag has captured the pointer.
 */
export function useHoverIntent(hold: () => boolean = neverHold) {
  // The latest `hold` is read at event time; the listeners and the edge state live for the whole window, so a
  // re-render (every snapshot) can never reset `inside` and swallow the next leave.
  const holdRef = useRef(hold);
  useEffect(() => { holdRef.current = hold; }, [hold]);
  useEffect(() => {
    const root = document.documentElement;
    let inside = false;
    const report = (next: boolean) => {
      if (next === inside || (!next && holdRef.current())) return;
      inside = next;
      void sendIntent({ kind: "hover", inside: next });
    };
    const enter = () => report(true);
    const leave = () => report(false);
    root.addEventListener("pointerenter", enter);
    root.addEventListener("pointerleave", leave);
    return () => { root.removeEventListener("pointerenter", enter); root.removeEventListener("pointerleave", leave); };
  }, []);
}
const neverHold = () => false;
