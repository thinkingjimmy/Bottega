/**
 * [INPUT]: Depends on the Dock bar item projection, shared metrics, the common glyph/name policy, the Widget faces, and the bar reorder gesture.
 * [OUTPUT]: Provides `BarItem`: one fixed-cross-axis button with content-aware extent, branded icon or Widget face, running/status/busy/open/highlight states, drag-out removal preview, native tooltip and accessible name, plus retained-summary warnings; Downloads and Trash stay anchored. Forwards the live App emoji.
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
const PluginDockCard=lazy(()=>import('../common/widgets/plugin-card').then(module=>({default:module.PluginDockCard})));
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
  const summaryError=item.widget?.type==='custom'&&item.widget.summaryError;
  const plugin=item.widget?.type==='custom'?item.widget.plugin:undefined;
  const interactive=Boolean(plugin?.customCard&&!mask&&item.widget?.type==='custom'&&item.widget.state==='ready');
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
      {interactive&&plugin?<Suspense fallback="—"><PluginDockCard key={`${item.id}/${plugin.revision}`} itemId={item.id} plugin={plugin} title={name} unavailable={t("systemDock.widgets.states.unavailable")} fallback={item.widget?.type==='custom'&&item.widget.summary?<DockSummary node={item.widget.summary} readings={item.widget.readings} locale={document.documentElement.lang||'en'}/>:null}/></Suspense>:item.widget?.type==='custom'?<span data-widget-summary="" data-widget-state={item.widget.state} aria-hidden="true" style={{display:'flex',alignItems:'center',justifyContent:'center',width:'100%',height:'100%',padding:4,overflow:'hidden',boxSizing:'border-box'}}>{!mask&&item.widget.summary?<Suspense fallback="—"><DockSummary node={item.widget.summary} readings={item.widget.readings} locale={document.documentElement.lang||'en'} /></Suspense>:mask?'—':<span style={{fontSize:10,lineHeight:1.2,textAlign:'center',whiteSpace:'normal',overflowWrap:'anywhere'}}>{t(`systemDock.widgets.states.${item.widget.state}`)}</span>}</span>:item.widget?.type === "builtin.tasks" ? <TasksFace vertical={vertical} face={item.widget} t={t} mask={mask} />
        : item.widget?.type === "builtin.ai-limits" ? <LimitsFace vertical={vertical} face={item.widget} t={t} mask={mask} now={now} />
        : item.widget?.type === "builtin.ai-activity" ? <ActivityFace vertical={vertical} face={item.widget} t={t} mask={mask} />
          : <DockGlyph subject={{ kind: item.kind, appIcon: item.appIcon, host: item.host, iconKey: item.iconKey, entry: item.entry, trash: item.trash }} icons={icons} />}
      {interactive&&<button type="button" aria-label={name} title={name} aria-haspopup="dialog" aria-expanded={open} onPointerDown={event=>event.stopPropagation()} onClick={()=>onActivate(item.id)} style={{position:"absolute",right:0,bottom:0,width:24,height:18,borderRadius:6,background:"var(--surface-solid)",color:"var(--text)",fontSize:14,lineHeight:1}}>⋯</button>}
      {summaryError?<span className="item-badge" data-plugin-summary-error="" role="status" title={t("systemDock.widgets.summaryRefreshFailed")}><CircleAlert aria-hidden="true" strokeWidth={2.2} style={{width:"100%",height:"100%"}}/><span className="visually-hidden">{t("systemDock.widgets.summaryRefreshFailed")}</span></span>:item.status !== "ok" && <CircleAlert className="item-badge" aria-hidden="true" strokeWidth={2.2} />}
    </span>
    {item.running && <span className="running-dot" aria-hidden="true" />}
  </Shell>;
}
