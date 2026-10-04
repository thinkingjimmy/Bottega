/**
 * [INPUT]: Native record bridge, Base snapshots and shared slot presentation.
 * [OUTPUT]: Lazy RecordPluginsHost without replacing the mounted workbench or its drafts.
 * [POS]: Desktop record contribution adapter; package UI stays in the shared isolated frame.
 */
import { useEffect, useState } from "react";
import type { RecordEntry } from "@bottega/contracts/plugins/records/contract";
import { baseRefSchema } from "@bottega/contracts/model/resources";
import { RecordPluginSlots, type RecordResultReader } from "@ai-chat/base-ui/ui/state/record-plugins";
import type { RecordContribution } from "@ai-chat/base-ui/ui/state/record-slots";
import { useBaseSnapshots } from "@/components/providers/content/bases-provider";
import { requestSettingsSection } from "@/lib/settings/navigation/settings-navigation";
import "@/lib/apps/plugins-client";
import { NativeRecordFrame } from "./frame";
const readResults: RecordResultReader = (target, read) => window.recordPlugins!.results(target, read);
const openSettings = (id: string) => requestSettingsSection({ section: "plugins", plugin: `sha256:${id.slice(5)}`, pluginView: "settings" });
export default function RecordPluginsHost({ ownerKey, disabled, onContributions }: {
  ownerKey: string; disabled?: boolean; onContributions(value: readonly RecordContribution[]): void;
}) {
  const snapshot = useBaseSnapshots().snapshots[ownerKey];
  const [entries, setEntries] = useState<readonly RecordEntry[]>([]);
  useEffect(() => {
    let live = true, revision = 0;
    const refresh = () => { const expected = ++revision; void window.recordPlugins?.list().then(value => {
      if (live && expected === revision) setEntries(value);
    }).catch(() => { if (live && expected === revision) setEntries([]); }); };
    refresh(); const off = window.pluginSurfaces?.onChanged(refresh);
    return () => { live = false; off?.(); };
  }, []);
  if (!snapshot || !window.recordPlugins) return null;
  return <RecordPluginSlots base={baseRefSchema.parse({ ownerKey, ownerInstanceId: snapshot.meta.ownerInstanceId })} entries={entries}
    disabled={disabled} Surface={NativeRecordFrame} readResults={readResults} onSettings={openSettings} onContributions={onContributions} />;
}
