/**
 * [INPUT]: Depends on the panel context (downloads projection, clock), the common relative-time formatter, and lucide kind glyphs.
 * [OUTPUT]: Provides `DownloadsDetail`: up to 20 newest entries (name, relative time, kind) that open through short-lived references, explicit loading/partial/empty/denied/missing/error states, and an always-available "Open Downloads in Finder".
 * [POS]: system-dock/panel/views/detail Downloads renderer (3.5); it never sees a path — main reverifies each reference before opening (INV-13, INV-14).
 */
import { File, Folder, FolderOpen, Package } from "lucide-react";
import type { DownloadEntry } from "../../../../../shared/system-dock/ipc";
import { relativeTime } from "../../../common/format";
import { usePanel } from "../../context";

const KIND_GLYPH = { file: File, directory: Folder, package: Package } as const;
const STATE_KEYS = {
  loading: "systemDock.downloads.loading", empty: "systemDock.downloads.empty", denied: "systemDock.downloads.denied",
  missing: "systemDock.downloads.missing", error: "systemDock.downloads.error",
} as const;

export function DownloadsDetail() {
  const { snapshot, t, now, send } = usePanel();
  const downloads = snapshot.downloads ?? { state: "loading" as const, entries: [] };
  const entries = downloads.state === "ok" || downloads.state === "partial" ? downloads.entries : [];
  const kindLabel = (entry: DownloadEntry) => t(entry.kind === "directory" ? "systemDock.downloads.kindFolder" : entry.kind === "package" ? "systemDock.downloads.kindPackage" : "systemDock.downloads.kindFile");
  return <>
    <div className="scroll">
      {downloads.state === "partial" && <p className="note" role="status">{t("systemDock.downloads.partial")}</p>}
      {entries.length > 0 ? <ul className="plain-list" aria-label={t("systemDock.downloads.listLabel")}>
        {entries.map((entry) => {
          const Glyph = KIND_GLYPH[entry.kind];
          const when = relativeTime(entry.modifiedAt, now);
          return <li key={entry.ref}>
            <button type="button" className="row" aria-label={t("systemDock.downloads.entryLabel", { name: entry.name, kind: kindLabel(entry), time: when })}
              onClick={() => send({ kind: "open-download", ref: entry.ref })}>
              <span className="row-glyph small"><Glyph aria-hidden="true" strokeWidth={1.6} /></span>
              <span className="row-text"><span className="row-title" title={entry.name}>{entry.name}</span></span>
              <span className="row-meta">{when}</span>
            </button>
          </li>;
        })}
      </ul> : downloads.state !== "ok" && downloads.state !== "partial"
        ? <p className="empty-state" role="status" data-tone={downloads.state === "denied" || downloads.state === "error" ? "caution" : undefined}>{t(STATE_KEYS[downloads.state])}</p>
        : <p className="empty-state" role="status">{t("systemDock.downloads.empty")}</p>}
    </div>
    <footer className="panel-footer">
      <button type="button" className="text-button" onClick={() => send({ kind: "reveal-downloads" })}><FolderOpen aria-hidden="true" />{t("systemDock.downloads.reveal")}</button>
    </footer>
  </>;
}
