/**
 * [INPUT]: Depends on React and the optional host-owned bounded Base review port.
 * [OUTPUT]: Provides account/owner-fenced synchronization status and an explicit editing fence while review is unavailable.
 * [POS]: Shared presentation subscription; no persistence or cloud transport is owned here.
 */
import { useEffect, useState } from "react";
import type { BaseSyncPresentation, BaseSyncReview } from "../../sync/model";
export function useBaseSyncReview(port: BaseSyncPresentation | undefined, ownerKey: string, baseId: string | undefined, revision: number | undefined) {
  const [state, setState] = useState<{ port: BaseSyncPresentation; key: string; value: BaseSyncReview | null; failed: boolean } | null>(null);
  const key = `${ownerKey}:${baseId}`;
  useEffect(() => {
    if (!port || !baseId) return;
    const controller = new AbortController(); let generation = 0;
    const refresh = () => {
      const expected = ++generation;
      void port.review({ ownerKey, baseId, afterId: null }, controller.signal).then(value => {
        if (!controller.signal.aborted && expected === generation) setState({ port, key, value, failed: false });
      }, () => {
        if (!controller.signal.aborted && expected === generation) setState({ port, key, value: null, failed: true });
      });
    };
    const unsubscribe = port.subscribe(refresh); refresh();
    return () => { controller.abort(); generation++; unsubscribe(); };
  }, [port, ownerKey, baseId, revision, key]);
  const current = state && state.port === port && state.key === key ? state : null;
  return { value: current?.value ?? null, failed: current?.failed ?? false,
    readOnly: Boolean(port && baseId && (!current || current.failed || current.value?.state === "deleted" || current.value?.state === "moving")) };
}
