/**
 * [INPUT]: Depends on the Dock bar item projection, shared metrics, the common glyph/name policy, the shared actual DockWidgetFace renderer, and the bar reorder gesture.
 * [OUTPUT]: Provides `BarItem`: one fixed-cross-axis button with content-aware extent, branded icon or Widget face, running/status/busy/open/highlight states, drag-out removal preview, native tooltip and accessible name, plus retained-summary warnings; Downloads and Trash stay anchored. Forwards the live App emoji; plugin-card fallback reuses the canonical Dock item unavailable label.
 * [POS]: system-dock/bar slot renderer composed by bar.tsx; it sends nothing itself — activation and context menus bubble to the bar's intent handlers.
 */

import {type CSSProperties} from "react";
import { CircleAlert } from "lucide-react";
import type { DockBarItem } from "../../../shared/system-dock/ipc";
import type { DockEdge } from "../../../shared/system-dock/local-state";
import { DOCK_METRICS, itemExtent, metricItem } from "../../../shared/system-dock/metrics";
import { dockItemName, hasDetail, type DockT } from "../common/format";
import { DockGlyph } from "../common/icons";
import { DockWidgetFace } from "../common/faces";
import { slotOffset, type useBarReorder } from "./reorder";

type Props = {
  edge: DockEdge; item: DockBarItem; index: number; area: "pinned" | "running"; t: DockT; mask: boolean; now: number; liveCard?: boolean;
  icons: ReadonlyMap<string, string | null>; open: boolean; busy: boolean; highlight: boolean;
  reorder: ReturnType<typeof useBarReorder>; onActivate(itemId: string): void;
};

export function BarItem({ edge, item, index, area, t, mask, now, icons, open, busy, highlight, reorder, onActivate, liveCard }: Props) {
  const name = dockItemName(item, t, mask, now);
  const offset = slotOffset(reorder.view, item.id, index, area);
  const dragging = reorder.view?.id === item.id;
  const removing = dragging && reorder.view?.removing;
  const vertical = edge !== "bottom";
  const extent = itemExtent(metricItem(item), edge);
  const custom = item.widget?.type === "custom" ? item.widget : undefined;
  const cross = custom && custom.officialWidget !== "bottega-ai-usage" ? 68 : DOCK_METRICS.item;
  const summaryError = custom?.summaryError;
  const interactive = Boolean(custom?.plugin?.customCard && liveCard !== false && !mask && !custom.officialWidget && custom.state === "ready");
  const Shell=interactive?'div':'button';
  const style = { width: vertical ? cross : extent, height: vertical ? extent : cross,
    "--offset": `${offset}px` } as CSSProperties;
  return <Shell type={interactive?undefined:"button"} role={interactive?"group":undefined} className="item" style={style} data-item-id={item.id} data-area={area} data-entry={item.entry} data-kind={item.kind}
    data-status={item.status} data-dragging={dragging || undefined} data-removing={removing || undefined} data-shifted={offset !== 0 && !dragging || undefined}
    data-open={open || undefined} data-highlight={highlight || undefined} aria-label={name} title={removing ? t("systemDock.menu.remove") : summaryError ? `${name} · ${t("systemDock.widgets.summaryRefreshFailed")}` : name} aria-busy={busy || undefined}
    aria-haspopup={!interactive&&hasDetail(item) ? "dialog" : undefined} aria-expanded={!interactive&&hasDetail(item) ? open : undefined}
    onPointerDown={(event) => { if (item.entry !== "system.downloads" && item.entry !== "system.trash") reorder.onPointerDown(event, item.id, area); }} onPointerMove={reorder.onPointerMove}
    onPointerUp={reorder.onPointerUp} onPointerCancel={reorder.onPointerCancel} onLostPointerCapture={reorder.onPointerCancel}
    onClick={interactive?undefined:() => { if (!reorder.consumeClick()) onActivate(item.id); }}>
    <span className="item-body">
      {item.widget ? <DockWidgetFace itemId={item.id} face={item.widget} t={t} mask={mask} now={now} edge={edge} title={name} liveCard={liveCard} />
        : <DockGlyph subject={{ kind: item.kind, appIcon: item.appIcon, host: item.host, iconKey: item.iconKey, entry: item.entry, trash: item.trash }} icons={icons} />}
      {interactive&&<button type="button" aria-label={name} title={name} aria-haspopup="dialog" aria-expanded={open} onPointerDown={event=>event.stopPropagation()} onClick={()=>onActivate(item.id)} style={{position:"absolute",right:0,bottom:0,width:24,height:18,borderRadius:6,background:"var(--surface-solid)",color:"var(--text)",fontSize:14,lineHeight:1}}>⋯</button>}
      {summaryError?<span className="item-badge" data-plugin-summary-error="" role="status" title={t("systemDock.widgets.summaryRefreshFailed")}><CircleAlert aria-hidden="true" strokeWidth={2.2} style={{width:"100%",height:"100%"}}/><span className="visually-hidden">{t("systemDock.widgets.summaryRefreshFailed")}</span></span>:item.status !== "ok" && <CircleAlert className="item-badge" aria-hidden="true" strokeWidth={2.2} />}
    </span>
    {item.running && <span className="running-dot" aria-hidden="true" />}
  </Shell>;
}
