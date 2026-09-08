/**
 * [INPUT]: Depends on React and browser focus/visibility events, with caller-owned deadlines.
 * [OUTPUT]: Provides a clock that wakes at the nearest evidence expiry and when the window resumes.
 * [POS]: Shared renderer clock for availability and relative usage-limit time; performs no I/O.
 */
import { useEffect, useState } from "react";
export function useEvidenceClock(deadlines: readonly number[] = [], active = true) {
  const [now, setNow] = useState(Date.now);
  const nearest = Math.min(...deadlines.filter((value) => value > now));
  useEffect(() => {
    if (!active) return;
    const update = () => setNow(Date.now());
    const timer = window.setTimeout(update, Math.max(1, Math.min(60_000, nearest - Date.now())));
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [active, nearest, now]);
  return now;
}
export const useMinuteClock = (active: boolean) => useEvidenceClock([], active);
