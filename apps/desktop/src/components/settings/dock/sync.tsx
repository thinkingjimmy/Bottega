/**
 * [INPUT]: Depends on React, the desktop i18n provider, Settings primitives, the Dock settings store, and the Dock sync status/merge conflict projections.
 * [OUTPUT]: Provides `DockSync`: the layout sync state in plain words and, when main needs a decision, a non-modal card — first sync (merge both / use cloud / use this Mac), per-conflict This Mac vs Cloud choices for a three-way merge, or the newer-format notice that overwrites nothing.
 * [POS]: settings/dock sync surface (4.3, INV-15); it only collects the user's choice — main performs the one snapshot merge — and never blocks using the Dock.
 */

import { useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsBadge, SettingsButton, SettingsChoiceRow, SettingsList, SettingsRow, SettingsSection, SettingsSurface } from "../settings-layout";
import { dockSettingsStore, type DockSettingsState } from "@/lib/system-dock-settings-client";
import type { DockSyncStatus } from "../../../../shared/system-dock/ipc";
import type { MergeConflict } from "../../../../shared/system-dock/merge";

const STATE_KEYS: Record<DockSyncStatus["state"], string> = {
  synced: "systemDock.sync.synced", pending: "systemDock.sync.pending", offline: "systemDock.sync.offline", "local-only": "systemDock.sync.localOnly",
  conflict: "systemDock.sync.conflict", blocked: "systemDock.sync.blocked", error: "systemDock.sync.error",
};
const FIRST_SYNC = [
  { strategy: "merge", labelKey: "systemDock.sync.mergeBoth", detailKey: "systemDock.sync.mergeBothDetail" },
  { strategy: "remote", labelKey: "systemDock.sync.useCloud", detailKey: "systemDock.sync.useCloudDetail" },
  { strategy: "local", labelKey: "systemDock.sync.useLocal", detailKey: "systemDock.sync.useLocalDetail" },
] as const;

function conflictLabel(conflict: MergeConflict, t: (key: string) => string) {
  if (conflict.kind === "order") return t("systemDock.sync.conflictOrder");
  if (conflict.kind === "agent-order") return t("systemDock.sync.conflictAgentOrder");
  const field = conflict.field;
  return field === "label" ? t("systemDock.sync.conflictName") : field === "widget" || field.startsWith("selectionByBackend.") ? t("systemDock.sync.conflictWidget")
    : t("systemDock.sync.conflictItem");
}

function ConflictCard({ sync, busy }: { sync: NonNullable<DockSyncStatus["conflict"]>; busy: boolean }) {
  const { t } = useAppTranslation();
  const [strategy, setStrategy] = useState<"merge" | "remote" | "local">("merge");
  const [choices, setChoices] = useState<("local" | "remote")[]>(() => sync.conflicts.map(() => "local"));
  if (sync.kind === "unsupported") return <SettingsSurface className="space-y-1 p-4" role="note">
    <p className="font-medium text-sm">{t("systemDock.sync.unsupportedTitle")}</p>
    <p className="text-muted-foreground text-xs leading-relaxed">{t("systemDock.sync.unsupportedBody")}</p>
  </SettingsSurface>;
  const apply = () => void dockSettingsStore.resolveConflict(sync.kind === "first-sync" ? { strategy, choices: [] } : { strategy: "merge", choices });
  return <SettingsSurface className="space-y-3 p-4" role="group" aria-labelledby="dock-sync-conflict-title">
    <div className="space-y-1">
      <p id="dock-sync-conflict-title" className="font-medium text-sm">{t(sync.kind === "first-sync" ? "systemDock.sync.firstSyncTitle" : "systemDock.sync.threeWayTitle")}</p>
      <p className="text-muted-foreground text-xs leading-relaxed">{t(sync.kind === "first-sync" ? "systemDock.sync.firstSyncBody" : "systemDock.sync.threeWayBody")}</p>
    </div>
    {sync.kind === "first-sync" ? <div role="radiogroup" aria-labelledby="dock-sync-conflict-title" className="divide-inset rounded-lg ring-1 ring-foreground/10">
      {FIRST_SYNC.map((option) => <SettingsChoiceRow key={option.strategy} label={t(option.labelKey)} description={t(option.detailKey)}
        checked={strategy === option.strategy} onSelect={() => setStrategy(option.strategy)} />)}
    </div> : <ul className="space-y-2">
      {sync.conflicts.map((conflict, index) => <li key={index}>
        <fieldset className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 ring-1 ring-foreground/10">
          <legend className="sr-only">{conflictLabel(conflict, t)}</legend>
          <span aria-hidden="true" className="text-sm">{conflictLabel(conflict, t)}</span>
          <span className="flex gap-3 text-xs">
            {(["local", "remote"] as const).map((side) => <label key={side} className="flex min-h-8 cursor-pointer items-center gap-1.5">
              <input type="radio" name={`dock-conflict-${index}`} className="accent-foreground" checked={choices[index] === side}
                onChange={() => setChoices((current) => current.map((value, position) => position === index ? side : value))} />
              {t(side === "local" ? "systemDock.sync.thisMac" : "systemDock.sync.cloud")}
            </label>)}
          </span>
        </fieldset>
      </li>)}
    </ul>}
    <div className="flex justify-end"><SettingsButton disabled={busy} onClick={apply}>{t("systemDock.sync.apply")}</SettingsButton></div>
  </SettingsSurface>;
}

export function DockSync({ state }: { state: DockSettingsState }) {
  const { t } = useAppTranslation();
  const sync = state.snapshot!.sync;
  const tone = sync.state === "synced" ? "neutral" : sync.state === "error" || sync.state === "blocked" ? "danger" : sync.state === "conflict" ? "warn" : "muted";
  return <SettingsSection title={t("systemDock.sync.title")} description={t("systemDock.sync.description")}>
    <SettingsList>
      <SettingsRow label={t("systemDock.sync.status")} badge={<SettingsBadge tone={tone}>{t(STATE_KEYS[sync.state])}</SettingsBadge>}
        description={sync.state === "offline" ? t("systemDock.sync.offlineDetail") : sync.state === "local-only" ? t("systemDock.sync.localOnlyDetail") : undefined} control={null} />
    </SettingsList>
    {sync.conflict && <ConflictCard key={JSON.stringify(sync.conflict)} sync={sync.conflict} busy={state.pending !== null} />}
  </SettingsSection>;
}
