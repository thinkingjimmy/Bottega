/**
 * [INPUT]: Depends on React, generic record slots, Workflow copy and the existing run chooser.
 * [OUTPUT]: Provides WorkflowRunsProvider as the first generic action/result contribution, WorkflowRunsSurface and keyed useKeptState.
 * [POS]: Workflow adaptation only; Base views consume generic slots while run state remains owned by the host.
 */
import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { PlayIcon } from "lucide-react";
import { useOptionalWorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { useAppTranslation } from "../platform/i18n";
import { RecordSlotsProvider, type RecordContribution } from "../state/record-slots";
import { baseActionButtonClass } from "../chrome/base-toolbar";
import { RunChooser } from "./run-chooser";
import type { RunChooserModel } from "./run-chooser";

/** `chooser` feeds the ▶ popover of a row; without it ▶ falls back to the view's onRunWorkflow. */
export type WorkflowRunsSurface = { tag(rowId: string): ReactNode; recordSection?(rowId: string): ReactNode; chooser?(rowId: string): RunChooserModel | null };
/** Workflow is a contribution host; Base views do not depend on Workflow state or its chooser. */
export function WorkflowRunsProvider({ value, children }: { value: WorkflowRunsSurface | null; children: ReactNode }) {
  const { i18n } = useAppTranslation();
  const copy = useOptionalWorkbenchCopy(i18n.language);
  const contributions = useMemo<readonly RecordContribution[]>(() => value && copy ? [{
    id: "workflow", label: copy.terms.workflow,
    actions: (rowId, title) => {
      const chooser = value.chooser?.(rowId);
      if (!chooser) return null;
      return <RunChooser model={chooser}><button type="button" data-row-action="run"
        className={`${baseActionButtonClass} pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${chooser.unavailable ? "text-muted-foreground opacity-50" : ""}`}
        data-unavailable={chooser.unavailable ? "" : undefined} aria-disabled={Boolean(chooser.unavailable)}
        title={chooser.unavailable ?? copy.base.runWorkflow} aria-label={`${copy.base.runWorkflow}: ${title}`}>
        <PlayIcon className="size-3.5" />
      </button></RunChooser>;
    },
    results: (rowId, placement) => placement === "record" ? value.recordSection?.(rowId) : <span data-row-run={rowId}>{value.tag(rowId)}</span>,
  }] : [], [value, copy]);
  return <RecordSlotsProvider contributions={contributions}>{children}</RecordSlotsProvider>;
}

/* A run surface's state, by key, outside any component (review 0926-r2 E2-02): an action waiting for its receipt, its later
   refusal and a decision being chosen live with the run, so closing and opening its details again, or any remount, keeps them.
   An entry back at its initial value is dropped. */
const kept = new Map<string, unknown>();
const watchers = new Map<string, Set<() => void>>();
export function useKeptState<T>(key: string, initial: T): [T, (next: T | ((previous: T) => T)) => void] {
  const subscribe = useCallback((listener: () => void) => {
    const set = watchers.get(key) ?? new Set<() => void>();
    watchers.set(key, set); set.add(listener);
    return () => { set.delete(listener); if (!set.size) watchers.delete(key); };
  }, [key]);
  const read = () => (kept.has(key) ? kept.get(key) : initial) as T;
  const value = useSyncExternalStore(subscribe, read, read);
  const update = useCallback((next: T | ((previous: T) => T)) => {
    const previous = (kept.has(key) ? kept.get(key) : initial) as T;
    const value = typeof next === "function" ? (next as (previous: T) => T)(previous) : next;
    if (Object.is(value, initial)) kept.delete(key); else kept.set(key, value);
    for (const listener of watchers.get(key) ?? []) listener();
  }, [key, initial]);
  return [value, update];
}
