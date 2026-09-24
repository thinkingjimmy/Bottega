/**
 * [INPUT]: Depends on the isolated Dock bridge adapter, shared bar metrics, the common translator/glyph cache, BarItem, and the reorder gesture.
 * [OUTPUT]: Provides `DockBar`: the handle-only state, the centred translucent strip (pinned, separator, running, overflow), the just-added highlight, the empty-layout CTA, hover/activate/context-menu/move/pin-running intents, and the refusal of external file drops.
 * [POS]: system-dock/bar root composed by main.tsx; main owns window bounds from the same DOCK_METRICS, every reveal delay, and what an activation means (launch, open detail, or close the served detail).
 */

import { useEffect, type CSSProperties, type MouseEvent } from "react";
import { Ellipsis, Plus } from "lucide-react";
import { DOCK_METRICS } from "../../../shared/system-dock/metrics";
import { isBarSnapshot, sendIntent, useDockSnapshot, useHoverIntent, useNow } from "../common/bridge";
import { dockTranslator } from "../common/format";
import { useDockIcons } from "../common/icons";
import { BarItem } from "./item";
import { useBarReorder, type ReorderDrop } from "./reorder";

/* The empty-layout call to action is the one bar face DOCK_METRICS does not size yet; main must
   reserve this width (DIP, before scale) for `snapshot.empty` or the label clips. */
export const EMPTY_CTA_WIDTH = DOCK_METRICS.emptyCta;

async function commitDrop(drop: ReorderDrop) {
  // Pinning a running App is its own command; the move only follows once main accepted the pin.
  if (drop.source === "running" && !(await sendIntent({ kind: "pin-running", itemId: drop.itemId }))) return;
  await sendIntent({ kind: "move", itemId: drop.itemId, index: drop.index });
}

function openContextMenu(event: MouseEvent<HTMLElement>) {
  event.preventDefault();
  const itemId = (event.target as Element).closest<HTMLElement>("[data-item-id]")?.dataset.itemId ?? null;
  void sendIntent({ kind: "context-menu", itemId });
}

export function DockBar() {
  const snapshot = useDockSnapshot(isBarSnapshot);
  const reorder = useBarReorder({ gap: DOCK_METRICS.gap, onDrop: (drop) => void commitDrop(drop) });
  useHoverIntent(reorder.dragging);
  const now = useNow();
  const icons = useDockIcons(snapshot ? [...snapshot.pinned, ...snapshot.running].map((item) => item.iconKey) : []);
  useEffect(() => {
    /* No item accepts external files in this release (3.2). The page never cancels dragover, so
       Chromium keeps its "not allowed" cursor; dropEffect makes the refusal explicit. */
    const refuse = (event: DragEvent) => { if (event.dataTransfer) event.dataTransfer.dropEffect = "none"; };
    window.addEventListener("dragenter", refuse);
    window.addEventListener("dragover", refuse);
    return () => { window.removeEventListener("dragenter", refuse); window.removeEventListener("dragover", refuse); };
  }, []);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-reduced-motion", Boolean(snapshot?.reducedMotion));
  }, [snapshot?.reducedMotion]);
  if (!snapshot) return null;
  const t = dockTranslator(snapshot.locale);
  if (!snapshot.revealed) {
    return snapshot.showHandle ? <main className="dock" onContextMenu={openContextMenu}>
      <span className="handle" data-testid="dock-handle" aria-hidden="true" style={{ width: DOCK_METRICS.handleWidth, height: DOCK_METRICS.handleHeight }} />
    </main> : null;
  }
  const activate = (itemId: string) => void sendIntent({ kind: "activate", itemId });
  const common = { t, mask: snapshot.privacyMask, now, icons, reorder, onActivate: activate };
  const style = { zoom: snapshot.scale, "--gap": `${DOCK_METRICS.gap}px`, "--pad": `${DOCK_METRICS.padding}px`,
    height: DOCK_METRICS.barHeight, borderRadius: DOCK_METRICS.stripRadius / snapshot.scale } as CSSProperties;
  return <main className="dock" data-mode={snapshot.mode}>
    <div className="strip" data-strip role="toolbar" aria-orientation="horizontal" aria-label={t("systemDock.bar.label")} style={style}
      data-dragging={reorder.view ? "true" : undefined} onContextMenu={openContextMenu}>
      {snapshot.empty ? <button type="button" className="empty-cta" style={{ width: EMPTY_CTA_WIDTH - DOCK_METRICS.padding * 2 }}
        onClick={() => void sendIntent({ kind: "open-panel", view: { kind: "add" } })}>
        <Plus aria-hidden="true" strokeWidth={2} /><span>{t("systemDock.bar.emptyCta")}</span>
      </button> : <>
        {snapshot.pinned.map((item, index) => <BarItem key={item.id} item={item} index={index} area="pinned" {...common}
          open={snapshot.panelTarget === item.id} busy={snapshot.busyItemId === item.id} highlight={snapshot.highlightItemId === item.id} />)}
        {snapshot.pinned.length > 0 && snapshot.running.length > 0 &&
          <span className="separator" role="separator" aria-orientation="vertical" style={{ width: DOCK_METRICS.separator - DOCK_METRICS.gap }} />}
        {snapshot.running.map((item, index) => <BarItem key={item.id} item={item} index={index} area="running" {...common}
          open={snapshot.panelTarget === item.id} busy={snapshot.busyItemId === item.id} highlight={snapshot.highlightItemId === item.id} />)}
        {snapshot.overflow > 0 && <button type="button" className="overflow" style={{ width: DOCK_METRICS.overflowButton }}
          aria-label={t("systemDock.bar.overflow", { count: snapshot.overflow })} title={t("systemDock.bar.overflow", { count: snapshot.overflow })}
          aria-haspopup="dialog" onClick={() => void sendIntent({ kind: "open-panel", view: { kind: "navigate" } })}>
          <Ellipsis aria-hidden="true" strokeWidth={2} />
        </button>}
      </>}
    </div>
  </main>;
}
