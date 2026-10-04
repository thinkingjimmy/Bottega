/**
 * [INPUT]: Native window-bound record leases and the shared native plugin frame.
 * [OUTPUT]: NativeRecordFrame with declared record dispatch and visible unavailable states.
 * [POS]: Record adapter for the same isolated transport used by Sketch; no session or bridge enters the iframe.
 */
import { useLayoutEffect, useCallback, useMemo, useRef, useState } from "react";
import type { RecordCall } from "@bottega/contracts/plugins/records/contract";
import type { RecordFrameProps } from "@ai-chat/base-ui/ui/state/record-plugins";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { NativePluginFrame } from "../../chat/sketch/host/plugin/surface";
import "@/lib/apps/plugins-client";
const beforeEnd = async () => {};
export function NativeRecordFrame(props: RecordFrameProps) {
  const { i18n, t } = useAppTranslation(), latest = useRef(props); useLayoutEffect(() => { latest.current = props; }, [props]);
  const lease = useRef<string | null>(null), [status, setStatus] = useState("loading");
  const port = useMemo(() => ({
    open: async () => { const result = await window.recordPlugins!.open(props.input); lease.current = result.id; return result; },
    validate: (id: string) => window.pluginSurfaces!.validate(id), release: (id: string) => window.pluginSurfaces!.release(id),
    onChanged: (listener: () => void) => window.pluginSurfaces!.onChanged(listener),
  }), [props.input]);
  const createDispatch = useCallback(() => async (operation: string, payload: unknown) => {
    if (!lease.current) throw new Error("plugin-lease-unavailable");
    if (operation === "plugin.open") return { actionId: props.input.actionId };
    if (operation === "plugin.heartbeat") return {};
    if (operation === "plugin.close") { latest.current.onClose(); return {}; }
    const answer = await window.recordPlugins!.call(lease.current, { operation, payload } as RecordCall);
    if (operation === "base.results.report") latest.current.onChanged();
    return answer;
  }, [props.input]);
  const entry = useMemo(() => ({ ...props.entry, error: null, composer: { id: props.entry.id, title: props.entry.name, icon: "puzzle" },
    sourceFormat: { id: "bottega.record", version: 1, readableVersions: [1] } }), [props.entry]);
  return <div className="relative min-h-0 flex-1">
    {status !== "ready" && <p role="status" className="absolute inset-0 grid place-items-center p-4 text-sm">{t(status === "loading" ? "bases.loading" : "bases.plugins.unavailable")}</p>}
    <NativePluginFrame entry={entry} port={port} preferences={{ locale: i18n.language, theme: document.documentElement.classList.contains("dark") ? "dark" : "light" }}
      createDispatch={createDispatch} beforeEnd={beforeEnd} onStatus={setStatus} />
  </div>;
}
