/**
 * [INPUT]: React state, an explicit dynamic loader and browser reload for cached module failures.
 * [OUTPUT]: useDeferredModule with retained success, failure recovery and reloadRequired; isModuleLoadFailure classifies browser module fetch failures.
 * [POS]: Panel loading lifecycle; late completions never mount a closed or replaced surface.
 */
import { useEffect, useReducer, useState } from "react";
export function isModuleLoadFailure(error: unknown) {
  return error instanceof Error && /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(error.message);
}
export function useDeferredModule<T>(load: () => Promise<T>, active = true) {
  const [attempt, retry] = useReducer(value => value + 1, 0);
  const [state, setState] = useState<{ load: typeof load; attempt: number; value: T | null; error: unknown }>(
    { load, attempt, value: null, error: null });
  const current = state.load === load && state.attempt === attempt ? state : null;
  const value = current?.value ?? null;
  const reloadRequired = isModuleLoadFailure(current?.error);
  useEffect(() => {
    if (!active || value) return;
    let live = true;
    void load().then(
      next => { if (live) setState({ load, attempt, value: next, error: null }); },
      error => { if (live) setState({ load, attempt, value: null, error }); },
    );
    return () => { live = false; };
  }, [load, active, attempt, value]);
  // Browsers cache failed module fetches for this document; another import cannot retry them.
  return { value, failed: current?.error != null, reloadRequired,
    retry: () => { if (reloadRequired) window.location.reload(); else retry(); } };
}
