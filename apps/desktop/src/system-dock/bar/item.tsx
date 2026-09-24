/**
 * [INPUT]: Depends on the Dock bar item projection, shared metrics, the common glyph/name policy, the Widget faces, and the bar reorder gesture.
 * [OUTPUT]: Provides `BarItem`: one fixed-width button with icon or Widget face, running dot, status badge, busy/open/just-added states, native tooltip and full accessible name, wired to activate and drag.
 * [POS]: system-dock/bar slot renderer composed by bar.tsx; it sends nothing itself — activation and context menus bubble to the bar's intent handlers.
 */

import type { CSSProperties } from "react";
import { CircleAlert } from "lucide-react";
import type { DockBarItem } from "../../../shared/system-dock/ipc";
import { itemWidth } from "../../../shared/system-dock/metrics";
import { dockItemName, hasDetail, type DockT } from "../common/format";
import { DockGlyph } from "../common/icons";
import { ActivityFace, LimitsFace } from "./faces";
import { slotOffset, type useBarReorder } from "./reorder";

type Props = {
  item: DockBarItem; index: number; area: "pinned" | "running"; t: DockT; mask: boolean; now: number;
  icons: ReadonlyMap<string, string | null>; open: boolean; busy: boolean; highlight: boolean;
  reorder: ReturnType<typeof useBarReorder>; onActivate(itemId: string): void;
};

export function BarItem({ item, index, area, t, mask, now, icons, open, busy, highlight, reorder, onActivate }: Props) {
  const name = dockItemName(item, t, mask, now);
  const offset = slotOffset(reorder.view, item.id, index, area);
  const dragging = reorder.view?.id === item.id;
  const style = { width: itemWidth({ kind: item.kind, widgetType: item.widget?.type }), "--offset": `${offset}px` } as CSSProperties;
  return <button type="button" className="item" style={style} data-item-id={item.id} data-area={area} data-kind={item.kind}
    data-status={item.status} data-dragging={dragging || undefined} data-shifted={offset !== 0 && !dragging || undefined}
    data-open={open || undefined} data-highlight={highlight || undefined} aria-label={name} title={name} aria-busy={busy || undefined}
    aria-haspopup={hasDetail(item) ? "dialog" : undefined} aria-expanded={hasDetail(item) ? open : undefined}
    onPointerDown={(event) => reorder.onPointerDown(event, item.id, area)} onPointerMove={reorder.onPointerMove}
    onPointerUp={reorder.onPointerUp} onPointerCancel={reorder.onPointerCancel} onLostPointerCapture={reorder.onPointerCancel}
    onClick={() => { if (!reorder.consumeClick()) onActivate(item.id); }}>
    <span className="item-body">
      {item.widget?.type === "builtin.ai-limits" ? <LimitsFace face={item.widget} t={t} mask={mask} now={now} />
        : item.widget?.type === "builtin.ai-activity" ? <ActivityFace face={item.widget} t={t} mask={mask} />
          : <DockGlyph subject={{ kind: item.kind, iconKey: item.iconKey, entry: item.entry, trash: item.trash }} icons={icons} />}
      {item.status !== "ok" && <CircleAlert className="item-badge" aria-hidden="true" strokeWidth={2.2} />}
    </span>
    {item.running && <span className="running-dot" aria-hidden="true" />}
  </button>;
}
