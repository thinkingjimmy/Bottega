/**
 * [INPUT]: Depends on React, the isolated `window.systemDock` bridge contract, the lazy locale catalog loader, and the renderer Intl locale snapshot.
 * [OUTPUT]: Provides the window typing, bar/panel snapshot guards, `useDockSnapshot` (revision-ordered, catalog/presentation-ready, locale synced), a coarse `useNow` clock, the fire-and-forget `sendIntent`, and `useHoverIntent` (edge-only window pointer presence).
 * [POS]: system-dock/common transport adapter shared by the bar and panel roots; the only file that touches `window.systemDock`'s snapshot stream.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DockBarSnapshot, DockIntent, PanelSnapshot, SystemDockBridge } from "../../../shared/system-dock/ipc";
import { loadCatalog } from "../../../shared/i18n/catalogs";
import { loadSection } from "../../../shared/i18n/sections";
import { setEffectiveLocale } from "../../lib/appearance/i18n-locale";

declare global { interface Window { systemDock?: SystemDockBridge } }

export const isBarSnapshot = (value: DockBarSnapshot | PanelSnapshot): value is DockBarSnapshot => "revealed" in value;
export const isPanelSnapshot = (value: DockBarSnapshot | PanelSnapshot): value is PanelSnapshot => "view" in value;

/**
 * Main pushes whole snapshots; an older revision arriving late (the initial invoke racing the
 * first push) must never overwrite a newer one. The catalog and the Dock's copy section load before the snapshot is shown
 * so the first painted frame is already in the user's language, never English then swapped.
 */
export function useDockSnapshot<T extends DockBarSnapshot | PanelSnapshot>(
  accept: (value: DockBarSnapshot | PanelSnapshot) => value is T,
  prepare?: (value: T) => Promise<unknown>,
): T | null {
  const [snapshot, setSnapshot] = useState<T | null>(null);
  useEffect(() => {
    let mounted = true;
    let revision = -1;
    let delivery = 0;
    const receive = async (value: DockBarSnapshot | PanelSnapshot) => {
      if (!accept(value) || value.revision < revision) return;
      revision = value.revision;
      const sequence = ++delivery;
      try {
        await Promise.all([
          Promise.all([loadCatalog(value.locale), loadSection("systemDock", value.locale)]).catch(() => undefined),
          prepare?.(value),
        ]);
      } catch { return; } // An unprepared layout must never reach React or emit its readiness acknowledgement.
      if (!mounted || sequence !== delivery) return;
      document.documentElement.lang = value.locale;
      document.documentElement.toggleAttribute("data-solid", Boolean(value.solidBackground));
      setEffectiveLocale(value.locale);
      setSnapshot(value);
    };
    const stop = window.systemDock?.onChanged((value) => void receive(value));
    void window.systemDock?.snapshot().then(receive).catch(() => undefined);
    return () => { mounted = false; stop?.(); };
  }, [accept, prepare]);
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
 * while the pointer is over either and owns every reveal/collapse delay (3.2). Only pointer edges and explicit handle presses are
 * sent; `hold` suppresses a leave while a drag has captured the pointer.
 */
export function useHoverIntent(hold: () => boolean = neverHold, placementRevision?: number) {
  // The latest `hold` is read at event time; the listeners and the edge state live for the whole window, so a
  // re-render cannot swallow the next leave. A new placement deliberately starts outside because the
  // old window may have moved away without a pointerleave; main resets its matching hover state.
  const holdRef = useRef(hold);
  const inside = useRef(false);
  useEffect(() => { holdRef.current = hold; }, [hold]);
  const report = useCallback((next: boolean, explicit = false) => {
    if ((!explicit && next === inside.current) || (!next && holdRef.current())) return;
    inside.current = next;
    void sendIntent({ kind: "hover", inside: next, ...(placementRevision === undefined ? {} : { placementRevision }) });
  }, [placementRevision]);
  useEffect(() => {
    const root = document.documentElement;
    inside.current = false;
    const enter = () => report(true);
    const leave = () => report(false);
    root.addEventListener("pointerenter", enter);
    root.addEventListener("pointerleave", leave);
    return () => { root.removeEventListener("pointerenter", enter); root.removeEventListener("pointerleave", leave); };
  }, [report]);
  return () => report(true, true);
}
const neverHold = () => false;
