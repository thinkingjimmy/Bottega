/**
 * [INPUT]: Depends on panel state/Escape layers, native download visuals, relative times and localized Dock copy.
 * [OUTPUT]: Provides DownloadsDetail with time groups, real thumbnails/system icons, inline enlarged previews and verified Open/Reveal actions.
 * [POS]: Isolated Dock Downloads detail; main owns file access and the renderer receives only short-lived references and bounded PNG data.
 */

import { useRef, useState } from "react";
import { ArrowUpRight, ChevronLeft, Download, FolderOpen, FolderSearch } from "lucide-react";
import type { DownloadEntry } from "../../../../../../shared/system-dock/ipc";
import { relativeTime } from "../../../../common/format";
import { useEscapeLayer, usePanel } from "../../../context";
import { DownloadImage, useDownloadVisual } from "./visual";

const STATE_KEYS = {
  loading: "systemDock.downloads.loading", empty: "systemDock.downloads.empty", denied: "systemDock.downloads.denied",
  missing: "systemDock.downloads.missing", error: "systemDock.downloads.error",
} as const;
const GROUP_KEYS = ["systemDock.downloads.groupRecent", "systemDock.downloads.groupWeek", "systemDock.downloads.groupEarlier"] as const;

// A directory update can arrive before the coarse panel clock ticks.
const fileTime = (at: number, now: number) => relativeTime(at, Math.max(now, Date.now()));

function groupIndex(at: number, now: number) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const recent = new Date(today), week = new Date(today);
  recent.setDate(recent.getDate() - 1);
  week.setDate(week.getDate() - 6);
  return at >= recent.getTime() ? 0 : at >= week.getTime() ? 1 : 2;
}

function typeLabel(entry: DownloadEntry, kindLabel: string) {
  const extension = entry.kind === "file" ? /\.([a-z0-9]{1,10})$/i.exec(entry.name)?.[1] : null;
  return extension ? extension.toUpperCase() : kindLabel;
}

function DownloadRow({ entry, preview }: { entry: DownloadEntry; preview(): void }) {
  const { t, now, send, mask } = usePanel();
  const { visual, loading } = useDownloadVisual(entry.ref, "thumbnail", mask);
  const kind = t(entry.kind === "directory" ? "systemDock.downloads.kindFolder" : entry.kind === "package" ? "systemDock.downloads.kindPackage" : "systemDock.downloads.kindFile");
  const when = fileTime(entry.modifiedAt, now);
  return <li className="download-row" data-download-ref={entry.ref}>
    <button type="button" className="download-thumbnail" disabled={mask} aria-label={t("systemDock.downloads.preview", { name: entry.name })}
      title={t("systemDock.downloads.preview", { name: entry.name })} onClick={preview}>
      <DownloadImage entry={entry} visual={visual} loading={loading} />
    </button>
    <button type="button" className="download-open" aria-label={t("systemDock.downloads.entryLabel", { name: entry.name, kind, time: when })}
      onClick={() => send({ kind: "open-download", ref: entry.ref })}>
      <span className="row-title" title={entry.name}>{entry.name}</span>
      <span className="download-meta">{typeLabel(entry, kind)} · {when}</span>
    </button>
    <button type="button" className="icon-button download-reveal" aria-label={t("systemDock.downloads.revealEntry", { name: entry.name })}
      title={t("systemDock.downloads.revealEntry", { name: entry.name })} onClick={() => send({ kind: "reveal-download", ref: entry.ref })}>
      <FolderSearch aria-hidden="true" />
    </button>
  </li>;
}

function DownloadPreview({ entry, back }: { entry: DownloadEntry; back(): void }) {
  const { t, now, mask, send } = usePanel();
  const { visual, loading } = useDownloadVisual(entry.ref, "preview", mask);
  return <section className="download-preview" aria-label={t("systemDock.downloads.preview", { name: entry.name })}>
    <button type="button" className="download-back" onClick={back} data-autofocus><ChevronLeft aria-hidden="true" />{t("systemDock.panel.back")}</button>
    <div className="download-preview-media" aria-busy={loading}>
      <DownloadImage entry={entry} visual={visual} loading={loading} />
    </div>
    <p className="download-preview-name">{entry.name}</p>
    <p className="download-meta">{fileTime(entry.modifiedAt, now)}</p>
    {!loading && !visual && <p className="note">{t("systemDock.downloads.previewUnavailable")}</p>}
    <p className="visually-hidden" role="status">{loading ? t("systemDock.downloads.previewLoading") : !visual ? t("systemDock.downloads.previewUnavailable") : ""}</p>
    <button type="button" className="button download-preview-open" onClick={() => send({ kind: "open-download", ref: entry.ref })}>{t("systemDock.downloads.openFile")}</button>
  </section>;
}

export function DownloadsDetail() {
  const { snapshot, t, now, send, mask } = usePanel();
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const downloads = snapshot.downloads ?? { state: "loading" as const, entries: [] };
  const entries = downloads.state === "ok" || downloads.state === "partial" ? downloads.entries : [];
  const selected = !mask ? entries.find((entry) => entry.ref === selectedRef) : undefined;
  const back = () => {
    setSelectedRef(null);
    requestAnimationFrame(() => {
      if (!root.current) return;
      root.current.scrollTop = listScroll.current;
      root.current.querySelector<HTMLButtonElement>(`[data-download-ref="${selectedRef}"] .download-thumbnail`)?.focus({ preventScroll: true });
    });
  };
  useEscapeLayer(Boolean(selected), back);
  return <>
    <div className="scroll downloads-scroll" ref={root}>
      {selected ? <DownloadPreview key={selected.ref} entry={selected} back={back} /> : <>
        {downloads.state === "partial" && <p className="note" role="status">{t("systemDock.downloads.partial")}</p>}
        {entries.length > 0 ? GROUP_KEYS.map((key, index) => {
          const group = entries.filter((entry) => groupIndex(entry.modifiedAt, now) === index);
          return group.length ? <section key={key} className="download-group" aria-label={t(key)}>
            <h2 className="download-group-label">{t(key)}</h2>
            <ul className="plain-list" aria-label={t("systemDock.downloads.listLabel")}>
              {group.map((entry) => <DownloadRow key={entry.ref} entry={entry} preview={() => {
                send({ kind: "focus-panel" });
                listScroll.current = root.current?.scrollTop ?? 0;
                setSelectedRef(entry.ref);
                requestAnimationFrame(() => {
                  if (!root.current) return;
                  root.current.scrollTop = 0;
                  root.current.querySelector<HTMLButtonElement>(".download-back")?.focus({ preventScroll: true });
                });
              }} />)}
            </ul>
          </section> : null;
        }) : <div className="empty-state download-empty" role="status" data-tone={downloads.state === "denied" || downloads.state === "error" ? "caution" : undefined}>
          <Download aria-hidden="true" strokeWidth={1.4} />
          <p>{t(downloads.state !== "ok" && downloads.state !== "partial" ? STATE_KEYS[downloads.state] : "systemDock.downloads.empty")}</p>
        </div>}
      </>}
    </div>
    <footer className="panel-footer downloads-footer">
      <button type="button" className="download-folder" onClick={() => send({ kind: "reveal-downloads" })}>
        <FolderOpen aria-hidden="true" /><span>{t("systemDock.downloads.reveal")}</span><ArrowUpRight aria-hidden="true" />
      </button>
    </footer>
  </>;
}
