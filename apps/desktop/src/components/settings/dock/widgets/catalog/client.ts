/**
 * [INPUT]: Main-only Widget catalog bridge, ordered Dock change notifications and document visibility.
 * [OUTPUT]: useWidgetCatalog with live projections, acknowledged visible instances and isolated cleanup.
 * [POS]: Read-only catalog transport; accepted definitions and mutations remain in their existing owners.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { WidgetCatalogSnapshot } from "../../../../../../shared/system-dock/widgets/catalog";
import type { SystemDockBridge } from "../../../../../../shared/system-dock/ipc";

export const catalogCardBridge: Pick<SystemDockBridge, "pluginSurface"> = {
  pluginSurface: input => window.systemDockSettings!.widgetCatalogSurface(input),
};
export function useWidgetCatalog(active: boolean) {
  const [snapshot, setSnapshot] = useState<WidgetCatalogSnapshot | null>(null);
  const [failed, setFailed] = useState(false), [revision, setRevision] = useState(0);
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set());
  const [ready, setReady] = useState<ReadonlySet<string>>(new Set());
  const [documentVisible, setDocumentVisible] = useState(document.visibilityState !== "hidden");
  const scope = active && documentVisible, [seenScope, setSeenScope] = useState(scope);
  if (scope !== seenScope) { setSeenScope(scope); setReady(new Set()); }
  const latest = useRef(-1);
  const observe = useCallback((id: string, shown: boolean) => {
    if (!shown) setReady(current => { if (!current.has(id)) return current; const next = new Set(current); next.delete(id); return next; });
    setVisible(current => {
    if (current.has(id) === shown) return current;
    const next = new Set(current); if (shown) next.add(id); else next.delete(id); return next;
    });
  }, []);
  useEffect(() => {
    const change = () => setDocumentVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    const api = window.systemDockSettings;
    if (!active || !documentVisible || !api) return;
    let alive = true, delivery = 0, frame = 0;
    const load = () => {
      const request = ++delivery;
      void api.widgetCatalogSnapshot().then(value => {
        if (!alive || request !== delivery || value.revision < latest.current) return;
        latest.current = value.revision; setSnapshot(value); setFailed(false);
      }, () => { if (alive && request === delivery) setFailed(true); });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; load(); }); };
    load(); const stop = api.onChanged(schedule), stopWidgets = api.onWidgetsChanged(schedule);
    return () => { alive = false; cancelAnimationFrame(frame); stop(); stopWidgets(); };
  }, [active, documentVisible, revision]);
  const ids = active && documentVisible ? [...visible].sort().join("\n") : "";
  useEffect(() => {
    const api = window.systemDockSettings; if (!api) return;
    let alive = true;
    const itemIds = ids ? ids.split("\n") : [];
    void api.setWidgetCatalogVisible({ itemIds }).then(() => {
      if (alive) { setReady(new Set(itemIds)); setRevision(value => value + 1); }
    }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [ids]);
  useEffect(() => () => { void window.systemDockSettings?.setWidgetCatalogVisible({ itemIds: [] }).catch(() => {}); }, []);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  return { snapshot, failed, ready, observe, refresh };
}
