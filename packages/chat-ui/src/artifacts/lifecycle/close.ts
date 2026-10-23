/**
 * [INPUT]: Mounted workspace save handlers and the owning presentation close action.
 * [OUTPUT]: Stable before-close registration and a serialized close guard with visible failure state.
 * [POS]: Shared Artifact presentation lifetime for fallback desktop and Web dialogs.
 */
import { useCallback, useRef, useState } from "react";
export function useArtifactCloseGuard() {
  const handlers = useRef(new Set<() => Promise<unknown>>()), pending = useRef<Promise<boolean> | null>(null);
  const [failed, setFailed] = useState(false);
  const beforeClose = useCallback((handler: () => Promise<unknown>) => {
    handlers.current.add(handler); return () => { handlers.current.delete(handler); };
  }, []);
  const close = useCallback((action: () => void): Promise<boolean> => {
    if (pending.current) return pending.current;
    const task = (async () => {
      try { await Promise.all([...handlers.current].map(handler => handler())); setFailed(false); action(); return true; }
      catch { setFailed(true); return false; }
    })();
    pending.current = task;
    void task.finally(() => { if (pending.current === task) pending.current = null; });
    return task;
  }, []);
  return { beforeClose, close, failed };
}
