/**
 * [INPUT]: Depends on the Dock bar item projection, shared metrics, the common glyph/name policy, the Widget faces, and the bar reorder gesture.
 * [OUTPUT]: Provides `BarItem`: one fixed-cross-axis button with content-aware extent, branded icon or Widget face, running/status/busy/open/highlight states, drag-out removal preview, native tooltip and accessible name; Downloads and Trash stay anchored. Forwards the live App emoji.
 * [POS]: system-dock/bar slot renderer composed by bar.tsx; it sends nothing itself — activation and context menus bubble to the bar's intent handlers.
 */

import {lazy,Suspense,type CSSProperties} from "react";
import { CircleAlert } from "lucide-react";
import type { DockBarItem } from "../../../shared/system-dock/ipc";
import type { DockEdge } from "../../../shared/system-dock/local-state";
import { DOCK_METRICS, itemExtent, metricItem } from "../../../shared/system-dock/metrics";
import { dockItemName, hasDetail, type DockT } from "../common/format";
import { DockGlyph } from "../common/icons";
import { ActivityFace, LimitsFace, TasksFace } from "./faces";
import { slotOffset, type useBarReorder } from "./reorder";
const DockSummary=lazy(()=>import('../common/widgets/summary').then(module=>({default:module.DockSummary})));

type Props = {
  edge: DockEdge; item: DockBarItem; index: number; area: "pinned" | "running"; t: DockT; mask: boolean; now: number;
  icons: ReadonlyMap<string, string | null>; open: boolean; busy: boolean; highlight: boolean;
  reorder: ReturnType<typeof useBarReorder>; onActivate(itemId: string): void;
};

export function BarItem({ edge, item, index, area, t, mask, now, icons, open, busy, highlight, reorder, onActivate }: Props) {
  const name = dockItemName(item, t, mask, now);
  const offset = slotOffset(reorder.view, item.id, index, area);
  const dragging = reorder.view?.id === item.id;
  const removing = dragging && reorder.view?.removing;
  const vertical = edge !== "bottom";
  const extent = itemExtent(metricItem(item), edge);
  const cross=item.widget?.type==='custom'?68:DOCK_METRICS.item;
  const style = { width: vertical ? cross : extent, height: vertical ? extent : cross,
    "--offset": `${offset}px` } as CSSProperties;
  return <button type="button" className="item" style={style} data-item-id={item.id} data-area={area} data-entry={item.entry} data-kind={item.kind}
    data-status={item.status} data-dragging={dragging || undefined} data-removing={removing || undefined} data-shifted={offset !== 0 && !dragging || undefined}
    data-open={open || undefined} data-highlight={highlight || undefined} aria-label={name} title={removing ? t("systemDock.menu.remove") : name} aria-busy={busy || undefined}
    aria-haspopup={hasDetail(item) ? "dialog" : undefined} aria-expanded={hasDetail(item) ? open : undefined}
    onPointerDown={(event) => { if (item.entry !== "system.downloads" && item.entry !== "system.trash") reorder.onPointerDown(event, item.id, area); }} onPointerMove={reorder.onPointerMove}
    onPointerUp={reorder.onPointerUp} onPointerCancel={reorder.onPointerCancel} onLostPointerCapture={reorder.onPointerCancel}
    onClick={() => { if (!reorder.consumeClick()) onActivate(item.id); }}>
    <span className="item-body">
      {item.widget?.type==='custom'?<span data-widget-summary="" data-widget-state={item.widget.state} aria-hidden="true" style={{display:'flex',alignItems:'center',justifyContent:'center',width:'100%',height:'100%',padding:4,overflow:'hidden',boxSizing:'border-box'}}>{!mask&&item.widget.summary?<Suspense fallback="—"><DockSummary node={item.widget.summary} readings={item.widget.readings} locale={document.documentElement.lang||'en'} /></Suspense>:mask?'—':<span style={{fontSize:10,lineHeight:1.2,textAlign:'center',whiteSpace:'normal',overflowWrap:'anywhere'}}>{t(`systemDock.widgets.states.${item.widget.state}`)}</span>}</span>:item.widget?.type === "builtin.tasks" ? <TasksFace vertical={vertical} face={item.widget} t={t} mask={mask} />
        : item.widget?.type === "builtin.ai-limits" ? <LimitsFace vertical={vertical} face={item.widget} t={t} mask={mask} now={now} />
        : item.widget?.type === "builtin.ai-activity" ? <ActivityFace vertical={vertical} face={item.widget} t={t} mask={mask} />
          : <DockGlyph subject={{ kind: item.kind, appIcon: item.appIcon, host: item.host, iconKey: item.iconKey, entry: item.entry, trash: item.trash }} icons={icons} />}
      {item.status !== "ok" && <CircleAlert className="item-badge" aria-hidden="true" strokeWidth={2.2} />}
    </span>
    {item.running && <span className="running-dot" aria-hidden="true" />}
  </button>;
}
