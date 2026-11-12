/**
 * [INPUT]: Actual Dock item/edge/privacy projections, shared metric geometry and acknowledged visible-instance authority.
 * [OUTPUT]: WidgetCatalogPreview using the same DockWidgetFace as the native Dock, at its exact intrinsic size.
 * [POS]: Non-interactive preview stage; host actions stay outside the actual Widget rendering.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DockBarItem } from "../../../../../../shared/system-dock/ipc";
import type { WidgetCatalogSnapshot } from "../../../../../../shared/system-dock/widgets/catalog";
import { itemExtent, metricItem } from "../../../../../../shared/system-dock/metrics";
import { DockWidgetFace } from "@/system-dock/common/faces";
import { dockItemName, type DockT } from "@/system-dock/common/format";
import { catalogCardBridge } from "./client";
import '@/system-dock/common/widgets/face-side.css';

export function WidgetCatalogPreview({ item, presentation, active, ready, observe, now, t }: {
  item: DockBarItem; presentation: WidgetCatalogSnapshot; active: boolean; ready: boolean; now: number; t: DockT;
  observe(id: string, visible: boolean): void;
}) {
  const slot = useRef<HTMLDivElement>(null), [scale, setScale] = useState(1);
  const edge = presentation.edge, extent = itemExtent(metricItem(item), edge);
  const cross = item.widget?.type === 'custom' && item.widget.officialWidget !== 'bottega-ai-usage' ? 68 : 48;
  const width = edge === 'bottom' ? extent : cross, height = edge === 'bottom' ? cross : extent;
  useEffect(() => {
    const node = slot.current; if (!node || !active) return;
    const observer = new IntersectionObserver(entries => observe(item.id, entries.some(entry => entry.isIntersecting)), { threshold: 0.01 });
    observer.observe(node);
    return () => { observer.disconnect(); observe(item.id, false); };
  }, [item.id, active, observe]);
  useLayoutEffect(() => {
    const node = slot.current; if (!node) return;
    const resize = () => setScale(Math.min(2.4, (node.clientWidth - 24) / width, (node.clientHeight - 24) / height));
    resize(); const observer = new ResizeObserver(resize); observer.observe(node); return () => observer.disconnect();
  }, [width, height]);
  return <div ref={slot} className="widget-catalog-preview" style={{ height: Math.max(164,height*1.5+24) }} data-widget-live-preview={item.id} role="img" aria-label={dockItemName(item,t,presentation.privacyMask,now)}>
    <div inert aria-hidden="true" style={{ width, height, flex: 'none', transform: `scale(${scale})`, transformOrigin: 'center' }}>
      {item.widget ? <DockWidgetFace itemId={item.id} face={item.widget} edge={edge} mask={presentation.privacyMask} now={now} t={t} title={item.label} bridge={catalogCardBridge} liveCard={active && ready && presentation.liveCards.includes(item.id)} /> : <span className="text-xs text-muted-foreground">{t('common.loading')}</span>}
    </div>
  </div>;
}
