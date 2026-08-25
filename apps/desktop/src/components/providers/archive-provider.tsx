/**
 * [INPUT]: Depends on React context/effect/state, archive-client snapshot and event subscription
 * [OUTPUT]: Provides ArchiveProvider/useArchive, unified archiving snapshots, busy/error and mutation submissions
 * [POS]: The only source of truth for the renderer of the archived providers; Settings page is responsible for selecting, previewing, confirming and presenting only
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ArchiveSnapshot } from "../../../shared/archive-ipc";
import { listArchive, onArchiveEvent } from "@/lib/archive-client";

type ArchiveContextValue = {
  snapshot: ArchiveSnapshot;
  busy: boolean;
  error: string;
  run: (task: () => Promise<ArchiveSnapshot>) => Promise<boolean>;
};

const EMPTY_SNAPSHOT: ArchiveSnapshot = { entities: [], revision: 0 };
const ArchiveContext = createContext<ArchiveContextValue | null>(null);
const newer = (current: ArchiveSnapshot, next: ArchiveSnapshot) =>
  next.revision >= current.revision ? next : current;

export function ArchiveProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const unsubscribe = onArchiveEvent((event) => {
      if (active) setSnapshot((current) => newer(current, event.snapshot));
    });
    void listArchive().then(
      (next) => {
        if (active) setSnapshot((current) => newer(current, next));
      },
      (cause) => {
        if (active) setError(messageOf(cause));
      }
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const run = useCallback(async (task: () => Promise<ArchiveSnapshot>) => {
    setBusy(true);
    setError("");
    try {
      const next = await task();
      setSnapshot((current) => newer(current, next));
      return true;
    } catch (cause) {
      setError(messageOf(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo(
    () => ({ snapshot, busy, error, run }),
    [busy, error, run, snapshot]
  );
  return (
    <ArchiveContext.Provider value={value}>{children}</ArchiveContext.Provider>
  );
}

export function useArchive() {
  const value = useContext(ArchiveContext);
  if (!value) throw new Error("useArchive 必须在 ArchiveProvider 内使用");
  return value;
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
