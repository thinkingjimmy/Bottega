/**
 * [INPUT]: Depends on React context/effects, the panel snapshot, the Dock translator and the intent sender.
 * [OUTPUT]: Provides `PanelContext`/`usePanel` (snapshot, translator, clock, mask, intents, detail navigation, announcements, focus mode) and `useEscapeLayer`, the registration point for one nested "go back one level" step.
 * [POS]: system-dock/panel shared state between panel.tsx and every view; views never read the bridge directly.
 */

import { createContext, useContext, useEffect, useRef } from "react";
import type { DockIntent, PanelSnapshot } from "../../../shared/system-dock/ipc";
import type { DockT } from "../common/format";

export type PanelSnapshotView = PanelSnapshot;
export type PanelApi = Readonly<{
  snapshot: PanelSnapshotView;
  t: DockT;
  now: number;
  mask: boolean;
  send(intent: DockIntent): void;
  /** Opens an item's detail from the keyboard list and remembers that Escape returns there. */
  openDetail(itemId: string): void;
  /** Records that the detail main is about to open for `itemId` was reached from the keyboard list. */
  rememberReturn(itemId: string): void;
  announce(text: string): void;
  /** True once the user entered the panel (keyboard, click, configuration); read-only hovers never steal focus (INV-09). */
  focused: boolean;
  escapeLayers: { current: (() => boolean)[] };
}>;

export const PanelContext = createContext<PanelApi | null>(null);
export function usePanel() {
  const value = useContext(PanelContext);
  if (!value) throw new Error("usePanel outside DockPanel");
  return value;
}

/**
 * While `active`, Escape runs `back` instead of closing the panel. Layers stack in mount order,
 * so the innermost step (a confirmation inside a detail) is undone first.
 */
export function useEscapeLayer(active: boolean, back: () => void) {
  const { escapeLayers } = usePanel();
  const handler = useRef(back);
  useEffect(() => { handler.current = back; });
  useEffect(() => {
    if (!active) return;
    const layer = () => { handler.current(); return true; };
    escapeLayers.current.push(layer);
    return () => { escapeLayers.current = escapeLayers.current.filter((value) => value !== layer); };
  }, [active, escapeLayers]);
}
