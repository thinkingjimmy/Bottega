/**
 * [INPUT]: Mounted workspace save handlers, the owning presentation close action and an optional committed-owner predicate.
 * [OUTPUT]: Stable before-close registration and per-owner serialized close guards; stale completions cannot close or change failure state.
 * [POS]: Shared Artifact presentation lifetime for fallback desktop and Web dialogs.
 */
import { useCallback, useRef, useState } from "react";
const alwaysCurrent = () => true;
export function useArtifactCloseGuard() {
  const handlers = useRef(new Set<() => Promise<unknown>>());
  const pending = useRef<{ task: Promise<boolean>; current(): boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const beforeClose = useCallback((handler: () => Promise<unknown>) => {
    handlers.current.add(handler); return () => { handlers.current.delete(handler); };
  }, []);
  const close = useCallback((action: () => void, current: () => boolean = alwaysCurrent): Promise<boolean> => {
    if (!current()) return Promise.resolve(false);
    if (pending.current?.current === current) return pending.current.task;
    const task = (async () => {
      try {
        await Promise.all([...handlers.current].map(handler => handler()));
        if (!current()) return false;
        setFailed(false); action(); return true;
      } catch { if (current()) setFailed(true); return false; }
    })();
    const request = { task, current }; pending.current = request;
    void task.finally(() => { if (pending.current === request) pending.current = null; });
    return task;
  }, []);
  return { beforeClose, close, failed };
}
