/**
 * [INPUT]: Depends on the desktop i18n provider and the system Dock import candidate projection.
 * [OUTPUT]: Provides `CandidateChecklist` (native checkboxes in system Dock order; unresolved or unsupported tiles stay visible, disabled, with their reason) and `readFailureKey`, the copy for an unreadable system Dock.
 * [POS]: settings/dock shared import picker used by the setup flow and "Copy from system Dock"; selection is local until the page confirms it (INV-01: candidates are never stored or uploaded).
 */

import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { DockSetupPreview, ImportCandidate } from "../../../../shared/system-dock/ipc";

const NOTE_KEYS: Record<NonNullable<ImportCandidate["note"]>, string> = {
  "recent-apps": "systemDock.settings.candidateNote.recentApps",
  file: "systemDock.settings.candidateNote.file",
  url: "systemDock.settings.candidateNote.url",
  spacer: "systemDock.settings.candidateNote.spacer",
  managed: "systemDock.settings.candidateNote.managed",
  unknown: "systemDock.settings.candidateNote.unknown",
};
const READ_FAILURE_KEYS: Record<NonNullable<DockSetupPreview["readFailure"]>, string> = {
  unavailable: "systemDock.settings.readFailure.unavailable",
  managed: "systemDock.settings.readFailure.managed",
  unknown: "systemDock.settings.readFailure.unknown",
};
export const readFailureKey = (failure: NonNullable<DockSetupPreview["readFailure"]>) => READ_FAILURE_KEYS[failure];

export function CandidateChecklist({ candidates, selected, onChange, label }: {
  candidates: readonly ImportCandidate[]; selected: ReadonlySet<string>; onChange(next: Set<string>): void; label: string;
}) {
  const { t } = useAppTranslation();
  const importable = candidates.filter((candidate) => candidate.status === "ok");
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(next);
  };
  return <fieldset className="space-y-1">
    <legend className="flex w-full items-center justify-between gap-4 pb-1 text-muted-foreground text-xs">
      <span>{label}</span>
      {importable.length > 1 && <button type="button" className="rounded-md px-2 py-1 text-foreground text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => onChange(selected.size === importable.length ? new Set() : new Set(importable.map((candidate) => candidate.key)))}>
        {t(selected.size === importable.length ? "systemDock.settings.selectNone" : "systemDock.settings.selectAll")}
      </button>}
    </legend>
    <ul className="max-h-72 divide-inset overflow-y-auto rounded-lg ring-1 ring-foreground/10 [--divide-inset:0.75rem]">
      {candidates.map((candidate) => {
        const disabled = candidate.status !== "ok";
        return <li key={candidate.key}>
          <label className={`flex min-h-11 items-center gap-3 px-3 py-2 text-sm ${disabled ? "text-muted-foreground" : "cursor-pointer"}`}>
            <input type="checkbox" className="size-4 accent-foreground" checked={!disabled && selected.has(candidate.key)} disabled={disabled}
              onChange={() => toggle(candidate.key)} />
            <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
            {candidate.note && <span className="shrink-0 text-muted-foreground text-xs">{t(NOTE_KEYS[candidate.note])}</span>}
          </label>
        </li>;
      })}
    </ul>
  </fieldset>;
}
