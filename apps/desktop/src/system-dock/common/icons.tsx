/**
 * [INPUT]: Depends on React, the isolated bridge's icon lookup, the canonical product mark, lucide glyphs, and Dock item/candidate projections.
 * [OUTPUT]: Provides `useDockIcons` (process-lifetime cache, one in-flight request per key) and `DockGlyph`, which draws the host product mark with native artwork sizing, a native icon when main supplied one and a neutral glyph otherwise, including a shaded frosted-glass Trash bin whose empty/full/unknown variants differ in shape. Uses live App emoji for Bottega App shortcuts.
 * [POS]: system-dock/common icon layer shared by bar items, the navigate list and the add picker; never decodes paths itself, only opaque keys main resolved (INV-13).
 */

import { useEffect, useId, useState } from "react";
import { PRODUCT_MARK_URL } from "@ai-chat/ui/components/workspace/brand";
import { AppWindow, ChartColumn, FolderDown, Gauge, HardDrive, ListTodo } from "lucide-react";
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
  // State stays visible in the silhouette: full has folded papers; unknown has a separate badge.
  const id = `trash${useId().replace(/[^\w-]/g, "")}`;
  const kind = state ?? "unknown";
  return <svg viewBox="0 0 48 48" data-trash={kind} aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#aab9c6" /><stop offset="0.18" stopColor="#e5edf2" />
        <stop offset="0.45" stopColor="#f7fbfe" /><stop offset="0.76" stopColor="#d8e2ea" /><stop offset="1" stopColor="#9eafbd" />
      </linearGradient>
      <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
        <stop stopColor="#f9fcff" /><stop offset="1" stopColor="#a9bac8" />
      </linearGradient>
      <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
        <stop stopColor="#ffffff" stopOpacity="0.04" /><stop offset="1" stopColor="#71889e" stopOpacity="0.3" />
      </linearGradient>
    </defs>
    <ellipse cx="24" cy="43.2" rx="11.5" ry="1.8" fill="#152739" opacity="0.13" />
    <ellipse cx="24" cy="12.5" rx="13.5" ry="3.8" fill="#869ba9" stroke="#5a7186" strokeOpacity="0.45" strokeWidth="0.7" />
    <ellipse cx="24" cy="12.7" rx="11.7" ry="2.5" fill="#455f73" fillOpacity="0.65" />
    {kind === "full" && <g stroke="#aebcc9" strokeWidth="0.6" strokeLinejoin="round">
      <path d="m14 14 1-8 9 1.5 2 10z" fill="#f5f8fc" />
      <path d="m21 15 5-11 7 3-1 12z" fill="#ffffff" />
      <path d="m26 4-1 5 5-2" fill="#e0e7ef" />
      <path d="m16 17 2-8 10 5-2 7z" fill="#e9eff6" />
      <path d="m29 17 1-7 5 2-1 8z" fill="#f8fbfd" />
    </g>}
    <path d="m10.7 13 3 25.5c.3 2.8 4.4 4.1 10.3 4.1s10-1.3 10.3-4.1l3-25.5c-5.9 3.8-20.7 3.8-26.6 0Z"
      fill={`url(#${id}-body)`} fillOpacity="0.92" stroke="#60788d" strokeOpacity="0.55" strokeWidth="0.8" />
    <path d="m11.2 15 2.7 23.4c.3 2.5 4.7 3.8 10.1 3.8s9.8-1.3 10.1-3.8L36.8 15c-6 2.7-19.6 2.7-25.6 0Z" fill={`url(#${id}-shade)`} />
    <path d="m15 17 2.2 21.4M19.5 18l1 21.8M24 18.4v21.8M28.5 18l-1 21.8M33 17l-2.2 21.4"
      fill="none" stroke="#8198ab" strokeOpacity="0.3" strokeWidth="0.8" strokeLinecap="round" />
    <path d="m13.3 17.2 2.2 20.4" fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M10.6 12.8c0 4.9 26.8 4.9 26.8 0" fill="none" stroke={`url(#${id}-rim)`} strokeWidth="1.8" strokeLinecap="round" />
    <path d="M15.3 39.1c3.5 2.2 13.9 2.2 17.4 0" fill="none" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="0.8" />
    {kind === "unknown" && <>
      <circle cx="37" cy="37" r="7" fill="#718398" stroke="#f5f9fd" strokeWidth="1.5" />
      <path d="M37 33.5v4" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="37" cy="40.3" r="1.1" fill="#ffffff" />
    </>}
  </svg>;
}

type GlyphSubject = Pick<DockBarItem, "kind" | "iconKey" | "host"> & { appIcon?: string | null; entry?: DockBarItem["entry"]; trash?: TrashState; widgetType?: string };
export function DockGlyph({ subject, icons, className }: { subject: GlyphSubject; icons: ReadonlyMap<string, string | null>; className?: string }) {
  if (subject.host) return <img className={`glyph native host ${className ?? ""}`} src={PRODUCT_MARK_URL} alt="" draggable={false} />;
  if (subject.kind === "bottega-app" && subject.appIcon) return <span className={`glyph art app-emoji ${className ?? ""}`} aria-hidden="true">
    <svg viewBox="0 0 48 48"><text x="24" y="24" textAnchor="middle" dominantBaseline="central" fontSize="36">{subject.appIcon}</text></svg>
  </span>;
  const url = subject.iconKey ? icons.get(subject.iconKey) : undefined;
  // The Trash always draws its own state glyph so a stale native icon can never claim "empty".
  if (subject.entry === "system.trash") return <span className={`glyph art ${className ?? ""}`}><TrashGlyph state={subject.trash} /></span>;
  if (url) return <img className={`glyph native ${className ?? ""}`} src={url} alt="" draggable={false} />;
  const Fallback = subject.entry === "system.downloads" ? FolderDown : subject.entry === "system.finder" ? HardDrive
    : subject.widgetType === "builtin.ai-limits" ? Gauge : subject.widgetType === "builtin.ai-activity" ? ChartColumn : subject.widgetType === "builtin.tasks" ? ListTodo : AppWindow;
  // While a native key is still loading, keep the slot neutral instead of flashing a generic glyph.
  if (subject.iconKey && !icons.has(subject.iconKey) && (subject.kind === "native-app" || subject.kind === "bottega-app" || subject.entry === "system.finder"))
    return <span className={`glyph placeholder ${className ?? ""}`} aria-hidden="true" />;
  return <span className={`glyph drawn ${className ?? ""}`}><Fallback aria-hidden="true" strokeWidth={1.6} /></span>;
}
