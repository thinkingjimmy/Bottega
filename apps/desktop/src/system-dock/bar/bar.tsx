/**
 * [INPUT]: Depends on the isolated Dock bridge adapter, shared bar metrics, on-demand side styles, the common translator/glyph cache, BarItem, and the reorder gesture.
 * [OUTPUT]: Provides `DockBar`: the three-edge strip, committed-layout ACKs, revision-fenced interaction and drag reorder/pinning/removal, the just-added highlight, the empty-layout CTA, and refusal of external file drops.
 * [POS]: system-dock/bar root composed by main.tsx; main owns window bounds from the same DOCK_METRICS, every reveal delay, and what an activation means (launch, open detail, or close the served detail).
 */

import { Fragment, useEffect, useLayoutEffect, type CSSProperties, type MouseEvent } from "react";
import { Ellipsis, Plus } from "lucide-react";
import type { DockBarSnapshot } from "../../../shared/system-dock/ipc";
import { barGroups, DOCK_METRICS, itemExtent, metricItem } from "../../../shared/system-dock/metrics";
import { isBarSnapshot, sendIntent, useDockSnapshot, useHoverIntent, useNow } from "../common/bridge";
import { dockTranslator } from "../common/format";
import { useDockIcons } from "../common/icons";
import { BarItem } from "./item";
import { useBarReorder, type ReorderDrop } from "./reorder";

/* Shared unscaled extent keeps the empty-layout action inside the main-owned window. */
export const EMPTY_CTA_WIDTH = DOCK_METRICS.emptyCta;

async function commitDrop(drop: ReorderDrop, placementRevision: number) {
  if (drop.kind === "remove") {
    await sendIntent({ kind: "remove", itemId: drop.itemId, placementRevision });
    return;
  }
  // Pinning a running App is its own command; the move only follows once main accepted the pin.
  if (drop.source === "running" && !(await sendIntent({ kind: "pin-running", itemId: drop.itemId, placementRevision }))) return;
  await sendIntent({ kind: "move", itemId: drop.itemId, index: drop.index, placementRevision });
}

function openContextMenu(event: MouseEvent<HTMLElement>, placementRevision: number) {
  event.preventDefault();
  const itemId = (event.target as Element).closest<HTMLElement>("[data-item-id]")?.dataset.itemId ?? null;
  void sendIntent({ kind: "context-menu", itemId, placementRevision });
}


let sidebarStyles: Promise<unknown> | null = null;
function prepareBar(snapshot: DockBarSnapshot): Promise<unknown> {
  if (snapshot.edge === "bottom") return Promise.resolve();
  // Vite resolves a CSS import after its stylesheet loads; a rejected load is retryable on the next snapshot.
  return sidebarStyles ??= import("./styles/sidebar.css").catch((cause) => { sidebarStyles = null; throw cause; });
}

export function DockBar() {
  const snapshot = useDockSnapshot(isBarSnapshot, prepareBar);
  // Usage polling only invalidates captured coordinates when the shared slot geometry changes.
  const resetKey = snapshot ? JSON.stringify([
    snapshot.placementRevision, snapshot.revealed, snapshot.scale, snapshot.empty, snapshot.overflow > 0,
    [snapshot.pinned, snapshot.running].map((items) => items.map((item) => [item.id, itemExtent(metricItem(item), snapshot.edge)])),
  ]) : "";
  const reorder = useBarReorder({ gap: DOCK_METRICS.gap, edge: snapshot?.edge ?? "bottom",
    resetKey,
    onDrop: (drop) => { if (snapshot) void commitDrop(drop, snapshot.placementRevision); } });
  const reveal = useHoverIntent(reorder.dragging, snapshot?.placementRevision);
  const committedPlacement = snapshot?.placementRevision;
  useLayoutEffect(() => {
    // This acknowledges the committed DOM, not a painted frame; main owns the bounded transition.
    if (committedPlacement !== undefined) void sendIntent({ kind: "layout-ready", placementRevision: committedPlacement });
  }, [committedPlacement]);
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
  const vertical = snapshot.edge !== "bottom";
  const placementRevision = snapshot.placementRevision;
  const contextMenu = (event: MouseEvent<HTMLElement>) => openContextMenu(event, placementRevision);
  if (!snapshot.revealed) {
    return snapshot.showHandle ? <main className="dock" data-edge={snapshot.edge} onContextMenu={contextMenu}>
      <button type="button" className="handle" data-testid="dock-handle" aria-label={t("systemDock.bar.label")} onClick={reveal} style={{ width: vertical ? DOCK_METRICS.handleHeight : DOCK_METRICS.handleWidth, height: vertical ? DOCK_METRICS.handleWidth : DOCK_METRICS.handleHeight }} />
    </main> : null;
  }
  const activate = (itemId: string) => void sendIntent({ kind: "activate", itemId, placementRevision });
  const common = { edge: snapshot.edge, t, mask: snapshot.privacyMask, now, icons, reorder, onActivate: activate };
  const style = { zoom: snapshot.scale, "--gap": `${DOCK_METRICS.gap}px`, "--pad": `${DOCK_METRICS.padding}px`,
    [vertical ? "width" : "height"]: DOCK_METRICS.barHeight, borderRadius: DOCK_METRICS.stripRadius / snapshot.scale } as CSSProperties;
  const overflowGroup = snapshot.running.length ? 1 : 0;
  const groups = barGroups(snapshot.pinned, snapshot.running)
    .map((group, index) => ({ ...group, overflow: snapshot.overflow > 0 && index === overflowGroup }))
    .filter((group) => group.items.length || group.overflow);
  return <main className="dock" data-mode={snapshot.mode} data-edge={snapshot.edge}>
    <div className="strip" data-strip role="toolbar" aria-orientation={vertical ? "vertical" : "horizontal"} aria-label={t("systemDock.bar.label")} style={style}
      data-dragging={reorder.view ? "true" : undefined} onContextMenu={contextMenu}>
      {snapshot.empty ? <button type="button" className="empty-cta" style={vertical ? { height: DOCK_METRICS.sidebarEmptyCta - DOCK_METRICS.padding * 2, width: DOCK_METRICS.item } : { width: EMPTY_CTA_WIDTH - DOCK_METRICS.padding * 2 }}
        onClick={() => void sendIntent({ kind: "open-panel", view: { kind: "add" }, placementRevision })}>
        <Plus aria-hidden="true" strokeWidth={2} /><span>{t("systemDock.bar.emptyCta")}</span>
      </button> : <>
        {groups.map((group, groupIndex) => <Fragment key={groupIndex}>
          {groupIndex > 0 && <span className="separator" role="separator" aria-orientation={vertical ? "horizontal" : "vertical"}
            style={{ [vertical ? "height" : "width"]: DOCK_METRICS.separator - DOCK_METRICS.gap }} />}
          {group.items.map((item) => <BarItem key={item.id} item={item}
            index={(group.area === "pinned" ? snapshot.pinned : snapshot.running).indexOf(item)} area={group.area} {...common}
            open={snapshot.panelTarget === item.id} busy={snapshot.busyItemId === item.id} highlight={snapshot.highlightItemId === item.id} />)}
        {group.overflow && <button type="button" className="overflow" style={{ width: vertical ? DOCK_METRICS.item : DOCK_METRICS.overflowButton, height: DOCK_METRICS.overflowButton }}
          aria-label={t("systemDock.bar.overflow", { count: snapshot.overflow })} title={t("systemDock.bar.overflow", { count: snapshot.overflow })}
          aria-haspopup="dialog" onClick={() => void sendIntent({ kind: "open-panel", view: { kind: "navigate" }, placementRevision })}>
          <Ellipsis aria-hidden="true" strokeWidth={2} />
        </button>}
        </Fragment>)}
      </>}
    </div>
  </main>;
}
