/**
 * [INPUT]: Depends on React, the isolated bridge's icon lookup, lucide glyphs, and Dock item/candidate projections.
 * [OUTPUT]: Provides `useDockIcons` (process-lifetime cache, one in-flight request per key) and `DockGlyph`, which draws a native icon when main supplied one and a neutral glyph otherwise, including a glass Trash bin whose empty/full/unknown variants differ in shape.
 * [POS]: system-dock/common icon layer shared by bar items, the navigate list and the add picker; never decodes paths itself, only opaque keys main resolved (INV-13).
 */

import { useEffect, useId, useState } from "react";
import { AppWindow, ChartColumn, FolderDown, Gauge, HardDrive } from "lucide-react";
import type { DockBarItem, TrashState } from "../../../shared/system-dock/ipc";

/* Icons are immutable per key for the renderer's lifetime; a destroyed panel starts empty again,
   which is the right trade for a window that lives at most ~60 s idle (5.2). */
const cache = new Map<string, string | null>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();
const ICON_PAGE = 32;

export function useDockIcons(keys: readonly (string | null)[]) {
  const [, setVersion] = useState(0);
  const wanted = keys.filter((key): key is string => Boolean(key));
  const missing = wanted.filter((key) => !cache.has(key) && !inflight.has(key));
  const signature = missing.join("\n");
  useEffect(() => {
    const listener = () => setVersion((value) => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  useEffect(() => {
    if (!signature || !window.systemDock) return;
    const keys = signature.split("\n");
    for (const key of keys) inflight.add(key);
    // Main accepts at most 128 keys per call and renders 32 per native round trip: ask in pages, paint as each lands.
    void (async () => {
      for (let index = 0; index < keys.length; index += ICON_PAGE) {
        const batch = keys.slice(index, index + ICON_PAGE);
        const icons = await window.systemDock!.icons(batch).catch(() => ({} as Record<string, string>));
        for (const key of batch) {
          const url = icons[key];
          // A key main could not resolve settles to "no icon" so the slot falls back instead of spinning forever.
          cache.set(key, typeof url === "string" && url.startsWith("data:image/") ? url : null);
          inflight.delete(key);
        }
        for (const listener of listeners) listener();
      }
    })();
  }, [signature]);
  return cache;
}

function TrashGlyph({ state }: { state: TrashState | undefined }) {
  /* Drawn rather than borrowed, as a glass wire bin that sits beside native App icons: the three states must differ in
     shape, not only colour — paper over the rim when full, a dark empty opening, a badge when unknown — so they stay
     distinguishable in high contrast and for colour-blind users (INV-12 "unknown" is never "empty"). */
  // Gradient ids must be valid url() fragments; useId may contain punctuation.
  const id = `trash${useId().replace(/[^\w-]/g, "")}`;
  const kind = state ?? "unknown";
  return <svg viewBox="0 0 48 48" data-trash={kind} aria-hidden="true">
    <defs><linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor="#dde1e8" /><stop offset="0.35" stopColor="#ffffff" /><stop offset="1" stopColor="#c6cbd5" />
    </linearGradient></defs>
    <path d="M10 11h28l-2.6 29.2a3 3 0 0 1-3 2.8H15.6a3 3 0 0 1-3-2.8z" fill={`url(#${id}-body)`} fillOpacity="0.78" stroke="rgb(60 66 80 / 0.38)" strokeWidth="0.8" />
    {kind === "full" && <path d="M12.5 13.5c3-4 7-1 9-4 2.5 3 6 0 8.5 3 2-2 5-1 6 1l-.4 5H12.9z" fill="#f6f6f4" stroke="rgb(0 0 0 / 0.14)" strokeWidth="0.6" />}
    <path d="M15.5 14.5l1.2 26M20.5 14.5l.5 26.5M24 14.5v26.5M27.5 14.5l-.5 26.5M32.5 14.5l-1.2 26" stroke="rgb(70 78 94 / 0.3)" strokeWidth="0.9" fill="none" />
    <path d="M12 18.5h24M12.4 24h23.2M12.9 29.5h22.2M13.3 35h21.4" stroke="rgb(70 78 94 / 0.18)" strokeWidth="0.8" fill="none" />
    <ellipse cx="24" cy="11" rx="14.2" ry="2.6" fill="rgb(255 255 255 / 0.9)" stroke="rgb(60 66 80 / 0.42)" strokeWidth="0.9" />
    <ellipse cx="24" cy="11.3" rx="12.4" ry="1.6" fill={kind === "full" ? "rgb(40 46 60 / 0.08)" : "rgb(40 46 60 / 0.24)"} />
    {kind === "unknown" && <>
      <circle cx="37" cy="37" r="7" fill="#8e8e93" stroke="#ffffff" strokeWidth="1.5" />
      <path d="M37 33.5v4" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="37" cy="40.3" r="1.1" fill="#ffffff" />
    </>}
  </svg>;
}

type GlyphSubject = Pick<DockBarItem, "kind" | "iconKey"> & { entry?: DockBarItem["entry"]; trash?: TrashState; widgetType?: string };
export function DockGlyph({ subject, icons, className }: { subject: GlyphSubject; icons: ReadonlyMap<string, string | null>; className?: string }) {
  const url = subject.iconKey ? icons.get(subject.iconKey) : undefined;
  // The Trash always draws its own state glyph so a stale native icon can never claim "empty".
  if (subject.entry === "system.trash") return <span className={`glyph art ${className ?? ""}`}><TrashGlyph state={subject.trash} /></span>;
  if (url) return <img className={`glyph native ${className ?? ""}`} src={url} alt="" draggable={false} />;
  const Fallback = subject.entry === "system.downloads" ? FolderDown : subject.entry === "system.finder" ? HardDrive
    : subject.widgetType === "builtin.ai-limits" ? Gauge : subject.widgetType === "builtin.ai-activity" ? ChartColumn : AppWindow;
  // While a native key is still loading, keep the slot neutral instead of flashing a generic glyph.
  if (subject.iconKey && !icons.has(subject.iconKey) && (subject.kind === "native-app" || subject.kind === "bottega-app" || subject.entry === "system.finder"))
    return <span className={`glyph placeholder ${className ?? ""}`} aria-hidden="true" />;
  return <span className={`glyph drawn ${className ?? ""}`}><Fallback aria-hidden="true" strokeWidth={1.6} /></span>;
}
