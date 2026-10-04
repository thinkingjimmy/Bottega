/**
 * [INPUT]: Depends on React state and timers.
 * [OUTPUT]: Provides useDelayed — true once `active` has held for the given milliseconds; resets the moment it drops.
 * [POS]: The one gate for "show it only if the wait is real": spinners, placeholder rows and recovery actions read it so a sub-threshold wait never paints anything.
 */
import { useEffect, useState } from "react";

export function useDelayed(ms: number, active = true) {
  const [elapsed, setElapsed] = useState(false);
  const [armed, setArmed] = useState(active);
  /* A flip of `active` restarts the clock from zero, settled in render rather
     than in an effect so the frame that stops waiting never shows a stale "shown". */
  if (armed !== active) {
    setArmed(active);
    setElapsed(false);
  }
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [ms, active]);
  return active && elapsed;
}
