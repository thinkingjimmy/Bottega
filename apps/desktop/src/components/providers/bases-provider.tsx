"use client";

/**
 * [INPUT]: Depends on React Context, shared BaseOwner changed/moved/migration Event rules with lib/bases client
 * [OUTPUT]: Provides BasesProvider/useBases with moved/changed snapshots, an explicit Project Base baseline-loaded fence, and revision-bound Base commands
 * [POS]: The single source of truth for the Base real-time state of the renderer; All IPC returns, navigation baseline, delta meta and event pull are through the ownerInstance/revision fence
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  BaseMetaPatch,
  BasePinnedSummary,
  BaseRow,
  BaseRowPatch,
  BasesEvent,
  BaseSnapshot,
} from "../../../shared/bases-ipc";
import { ownerFromKey, ownerKeyOf } from "../../../shared/bases-ipc";
import {
  deleteBaseRows,
  discardCorruptBase,
  ensureBase,
  exportBaseCsv,
  exportBaseJson,
  exportBaseXlsx,
  getBase,
  getBaseRowHistory,
  insertBaseRows,
  importBaseJson,
  importBaseXlsx,
  listPinnedBases,
  listProjectBases,
  onBasesEvent,
  patchBaseRow,
  promoteBaseToProject,
  resolveBaseForSection,
  updateBaseMeta,
} from "@/lib/bases/client";
import { errorMessage } from "@/lib/errors";

type BasesContextValue = {
  snapshots: Readonly<Record<string, BaseSnapshot>>;
  movedOwners: Readonly<Record<string, string>>;
  pinned: BasePinnedSummary[];
  projectBases: BasePinnedSummary[];
  projectBasesLoaded: boolean;
  warning: string;
  get(ownerKey: string): Promise<BaseSnapshot | null>;
  ensure(ownerKey: string): Promise<BaseSnapshot>;
  discardCorrupt(ownerKey: string): Promise<BaseSnapshot>;
  updateMeta(input: {
    ownerKey: string;
    expectedRevision: number;
    patch: BaseMetaPatch;
    surfaceLeaseId?: string;
  }): Promise<BaseSnapshot>;
  insertRows(ownerKey: string, rows: BaseRow[], surfaceLeaseId?: string): Promise<BaseSnapshot>;
  patchRow(
    ownerKey: string,
    rowId: string,
    patch: BaseRowPatch,
    surfaceLeaseId?: string
  ): Promise<BaseSnapshot>;
  deleteRows(
    ownerKey: string,
    rowIds: string[],
    expectedRevision: number,
    surfaceLeaseId?: string
  ): Promise<BaseSnapshot>;
  exportCsv(ownerKey: string): ReturnType<typeof exportBaseCsv>;
  exportJson(ownerKey: string): ReturnType<typeof exportBaseJson>;
  exportXlsx(ownerKey: string): ReturnType<typeof exportBaseXlsx>;
  importJson(
    ownerKey: string,
    expectedRevision: number
  ): ReturnType<typeof importBaseJson>;
  importXlsx(
    ownerKey: string,
    expectedRevision: number
  ): ReturnType<typeof importBaseXlsx>;
  rowHistory(
    ownerKey: string,
    rowId: string
  ): ReturnType<typeof getBaseRowHistory>;
  resolveForSection: typeof resolveBaseForSection;
  promoteToProject: typeof promoteBaseToProject;
};

const BasesContext = createContext<BasesContextValue | null>(null);

type BaseReloadFlight = {
  targetOwnerInstance: string | null;
  promise: Promise<BaseSnapshot | null>;
};

type BaseReloadContext = {
  flights: Map<string, BaseReloadFlight>;
  load: (ownerKey: string) => Promise<BaseSnapshot | null>;
  remember: (
    snapshot: BaseSnapshot,
    expectedOwnerInstance?: string | null
  ) => BaseSnapshot | null;
  current: (ownerKey: string) => BaseSnapshot | undefined;
};

export function mergeBaseEvent(
  current: BaseSnapshot | undefined,
  event: Extract<BasesEvent, { type: "base-changed" }>
): { kind: "discard" | "reload" | "apply"; snapshot?: BaseSnapshot } {
  if (!current) return { kind: "reload" };
  if (
    ownerKeyOf(current.meta.owner) !== event.ownerKey ||
    current.meta.ownerInstanceId !== event.ownerInstanceId
  ) {
    return { kind: "discard" };
  }
  if (event.revision <= current.meta.revision) return { kind: "discard" };
  if (event.revision !== current.meta.revision + 1) return { kind: "reload" };
  if (!event.meta && !event.upserts && !event.removedRowIds) {
    return { kind: "reload" };
  }
  const rows = new Map(current.rows.map((row) => [row.id, row]));
  event.upserts?.forEach((row) => rows.set(row.id, row));
  event.removedRowIds?.forEach((id) => rows.delete(id));
  const rowsChanged =
    event.upserts !== undefined || event.removedRowIds !== undefined;
  return {
    kind: "apply",
    snapshot: {
      ...current,
      meta:
        event.meta ??
        {
          ...current.meta,
          revision: event.revision,
          rowsGeneration:
            current.meta.rowsGeneration + (rowsChanged ? 1 : 0),
        },
      rows: [...rows.values()],
    },
  };
}

export function mergeBaseSnapshot(
  current: BaseSnapshot | undefined,
  incoming: BaseSnapshot,
  expectedOwnerInstance?: string | null
) {
  if (!current) return incoming;
  if (ownerKeyOf(current.meta.owner) !== ownerKeyOf(incoming.meta.owner)) {
    throw new Error("不能合并不同 owner 的 Base snapshot");
  }
  if (current.meta.ownerInstanceId === incoming.meta.ownerInstanceId) {
    return incoming.meta.revision > current.meta.revision ? incoming : current;
  }
  if (
    expectedOwnerInstance !== undefined &&
    current.meta.ownerInstanceId !== expectedOwnerInstance
  ) {
    return current;
  }
  return incoming;
}

export function moveBaseSnapshot(
  current: Readonly<Record<string, BaseSnapshot>>,
  event: Extract<BasesEvent, { type: "base-moved" }>
): {
  snapshots: Record<string, BaseSnapshot>;
  applied: boolean;
} {
  const source = current[event.from.ownerKey];
  if (
    source &&
    source.meta.ownerInstanceId !== event.from.ownerInstanceId
  ) {
    return { snapshots: { ...current }, applied: false };
  }
  const next = { ...current };
  delete next[event.from.ownerKey];
  if (source) {
    const targetOwner = ownerFromKey(event.to.ownerKey);
    next[event.to.ownerKey] = {
      ...source,
      meta: {
        ...source.meta,
        owner:
          targetOwner.kind === "project"
            ? targetOwner
            : {
                ...targetOwner,
                incarnationId: event.to.ownerInstanceId,
              },
        ownerInstanceId: event.to.ownerInstanceId,
        revision: event.revision,
      },
    };
  }
  return { snapshots: next, applied: true };
}

export function createBaseReloader(
  load: BaseReloadContext["load"],
  remember: BaseReloadContext["remember"],
  current: (ownerKey: string) => BaseSnapshot | undefined
) {
  const context = {
    flights: new Map<string, BaseReloadFlight>(),
    load,
    remember,
    current,
  };
  return (ownerKey: string, requestedOwnerInstance?: string) =>
    requestBaseReload(context, ownerKey, requestedOwnerInstance);
}

function requestBaseReload(
  context: BaseReloadContext,
  ownerKey: string,
  requestedOwnerInstance?: string
): Promise<BaseSnapshot | null> {
  const targetOwnerInstance =
    requestedOwnerInstance ??
    context.current(ownerKey)?.meta.ownerInstanceId ??
    null;
  const existing = context.flights.get(ownerKey);
  if (existing?.targetOwnerInstance === targetOwnerInstance) {
    return existing.promise;
  }
  if (existing) {
    const retry = () =>
      requestBaseReload(
        context,
        ownerKey,
        targetOwnerInstance ?? undefined
      );
    return existing.promise.then(retry, retry);
  }
  const startedOwnerInstance =
    context.current(ownerKey)?.meta.ownerInstanceId ?? null;
  const flight = context
    .load(ownerKey)
    .then((snapshot) => {
      if (
        !snapshot ||
        (targetOwnerInstance &&
          snapshot.meta.ownerInstanceId !== targetOwnerInstance)
      ) {
        return null;
      }
      return context.remember(snapshot, startedOwnerInstance);
    })
    .finally(() => {
      if (context.flights.get(ownerKey)?.promise === flight) {
        context.flights.delete(ownerKey);
      }
    });
  context.flights.set(ownerKey, {
    targetOwnerInstance,
    promise: flight,
  });
  return flight;
}

export async function reloadBaseEvent(
  reload: (
    ownerKey: string,
    ownerInstanceId?: string
  ) => Promise<BaseSnapshot | null>,
  event: Extract<BasesEvent, { type: "base-changed" }>
) {
  try {
    const snapshot = await reload(event.ownerKey, event.ownerInstanceId);
    if (
      snapshot?.meta.ownerInstanceId === event.ownerInstanceId &&
      snapshot.meta.revision < event.revision
    ) {
      await reload(event.ownerKey, event.ownerInstanceId);
    }
    return null;
  } catch (cause) {
    return `Base ${event.ownerKey} 重拉失败：${errorMessage(cause)}`;
  }
}

function sortPinned(values: Iterable<BasePinnedSummary>) {
  return [...values].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.ownerKey.localeCompare(right.ownerKey)
  );
}

export function BasesProvider({ children }: { children: React.ReactNode }) {
  const [snapshots, setSnapshots] = useState<Record<string, BaseSnapshot>>({});
  const [movedOwners, setMovedOwners] = useState<Record<string, string>>({});
  const [pinned, setPinned] = useState<BasePinnedSummary[]>([]);
  const [projectBases, setProjectBases] = useState<BasePinnedSummary[]>([]);
  const [projectBasesLoaded, setProjectBasesLoaded] = useState(false);
  const [warning, setWarning] = useState("");
  const snapshotsRef = useRef<Record<string, BaseSnapshot>>({});
  const pinnedRef = useRef(new Map<string, BasePinnedSummary>());
  const projectBasesRef = useRef(new Map<string, BasePinnedSummary>());
  const removedRef = useRef(new Map<string, Set<string>>());
  const initializingRef = useRef(true);
  const bufferedEventsRef = useRef<BasesEvent[]>([]);
  const reloadFlightsRef = useRef(new Map<string, BaseReloadFlight>());

  const remember = useCallback((
    snapshot: BaseSnapshot,
    expectedOwnerInstance?: string | null
  ): BaseSnapshot | null => {
    if (snapshot.warning) setWarning(snapshot.warning);
    const ownerKey = ownerKeyOf(snapshot.meta.owner);
    if (
      removedRef.current
        .get(ownerKey)
        ?.has(snapshot.meta.ownerInstanceId)
    ) {
      return snapshotsRef.current[ownerKey] ?? null;
    }
    const current = snapshotsRef.current[ownerKey];
    const merged = mergeBaseSnapshot(
      current,
      snapshot,
      expectedOwnerInstance
    );
    if (merged === current) return current;
    snapshotsRef.current = {
      ...snapshotsRef.current,
      [ownerKey]: merged,
    };
    setSnapshots(snapshotsRef.current);
    const summary = {
      ownerKey,
      ownerInstanceId: merged.meta.ownerInstanceId,
      name: merged.meta.name,
      revision: merged.meta.revision,
    };
    if (merged.meta.pinned) {
      pinnedRef.current.set(ownerKey, summary);
    } else {
      pinnedRef.current.delete(ownerKey);
    }
    setPinned(sortPinned(pinnedRef.current.values()));
    if (merged.meta.owner.kind === "project") {
      projectBasesRef.current.set(ownerKey, summary);
      setProjectBases(sortPinned(projectBasesRef.current.values()));
    }
    return merged;
  }, []);

  const reload = useCallback(
    (
      ownerKey: string,
      requestedOwnerInstance?: string
    ) =>
      requestBaseReload(
        {
          flights: reloadFlightsRef.current,
          load: getBase,
          remember,
          current: (key) => snapshotsRef.current[key],
        },
        ownerKey,
        requestedOwnerInstance
      ),
    [remember]
  );

  const handleReloadEvent = useCallback(
    async (event: Extract<BasesEvent, { type: "base-changed" }>) => {
      const reloadWarning = await reloadBaseEvent(reload, event);
      if (reloadWarning) setWarning(reloadWarning);
    },
    [reload]
  );

  const applyEvent = useCallback(
    (event: BasesEvent) => {
      if (event.type === "warning") return setWarning(event.message);
      if (event.type === "base-migrated") {
        void reload(event.ownerKey, event.ownerInstanceId);
        return;
      }
      if (event.type === "removed") {
        const removed =
          removedRef.current.get(event.ownerKey) ?? new Set<string>();
        removed.add(event.ownerInstanceId);
        removedRef.current.set(event.ownerKey, removed);
        if (
          snapshotsRef.current[event.ownerKey]?.meta.ownerInstanceId ===
          event.ownerInstanceId
        ) {
          const next = { ...snapshotsRef.current };
          delete next[event.ownerKey];
          snapshotsRef.current = next;
          setSnapshots(next);
        }
        if (
          pinnedRef.current.get(event.ownerKey)?.ownerInstanceId ===
          event.ownerInstanceId
        ) {
          pinnedRef.current.delete(event.ownerKey);
          setPinned(sortPinned(pinnedRef.current.values()));
        }
        if (
          projectBasesRef.current.get(event.ownerKey)?.ownerInstanceId ===
          event.ownerInstanceId
        ) {
          projectBasesRef.current.delete(event.ownerKey);
          setProjectBases(sortPinned(projectBasesRef.current.values()));
        }
        return;
      }
      if (event.type === "base-moved") {
        const moved = moveBaseSnapshot(snapshotsRef.current, event);
        if (!moved.applied) return;
        const retired =
          removedRef.current.get(event.from.ownerKey) ?? new Set<string>();
        retired.add(event.from.ownerInstanceId);
        removedRef.current.set(event.from.ownerKey, retired);
        const next = moved.snapshots;
        snapshotsRef.current = next;
        setSnapshots(next);
        setMovedOwners((current) => ({
          ...current,
          [event.from.ownerKey]: event.to.ownerKey,
        }));
        pinnedRef.current.delete(event.from.ownerKey);
        projectBasesRef.current.delete(event.from.ownerKey);
        if (next[event.to.ownerKey]) remember(next[event.to.ownerKey]);
        void reload(event.to.ownerKey, event.to.ownerInstanceId);
        return;
      }
      const merged = mergeBaseEvent(
        snapshotsRef.current[event.ownerKey],
        event
      );
      if (merged.kind === "reload") {
        void handleReloadEvent(event);
      }
      if (merged.kind === "apply") remember(merged.snapshot!);
    },
    [handleReloadEvent, reload, remember]
  );

  useEffect(() => {
    let active = true;
    initializingRef.current = true;
    bufferedEventsRef.current = [];
    const unsubscribe = onBasesEvent((event) => {
      if (!active) return;
      if (initializingRef.current) {
        bufferedEventsRef.current.push(event);
        return;
      }
      applyEvent(event);
    });
    const finishInitialization = () => {
      if (!active) return;
      initializingRef.current = false;
      setProjectBasesLoaded(true);
      const buffered = bufferedEventsRef.current;
      bufferedEventsRef.current = [];
      buffered.forEach(applyEvent);
    };
    void Promise.all([listPinnedBases(), listProjectBases()])
      .then(([result, projectResult]) => {
        if (!active) return;
        const baseline = new Map(
          result.bases.map((item) => [item.ownerKey, item])
        );
        const projectBaseline = new Map(
          projectResult.bases.map((item) => [item.ownerKey, item])
        );
        for (const snapshot of Object.values(snapshotsRef.current)) {
          const ownerKey = ownerKeyOf(snapshot.meta.owner);
          const summary = {
            ownerKey,
            ownerInstanceId: snapshot.meta.ownerInstanceId,
            name: snapshot.meta.name,
            revision: snapshot.meta.revision,
          };
          if (snapshot.meta.pinned) {
            baseline.set(ownerKey, summary);
          } else {
            baseline.delete(ownerKey);
          }
          if (snapshot.meta.owner.kind === "project") {
            projectBaseline.set(ownerKey, summary);
          }
        }
        for (const [ownerKey, ownerInstances] of removedRef.current) {
          if (
            ownerInstances.has(
              baseline.get(ownerKey)?.ownerInstanceId ?? ""
            )
          ) {
            baseline.delete(ownerKey);
          }
          if (
            ownerInstances.has(
              projectBaseline.get(ownerKey)?.ownerInstanceId ?? ""
            )
          ) {
            projectBaseline.delete(ownerKey);
          }
        }
        pinnedRef.current = baseline;
        setPinned(sortPinned(baseline.values()));
        projectBasesRef.current = projectBaseline;
        setProjectBases(sortPinned(projectBaseline.values()));
        if (result.warning || projectResult.warning) {
          setWarning(result.warning ?? projectResult.warning ?? "");
        }
      })
      .catch((cause) => {
        if (active) setWarning(`Bases 加载失败：${errorMessage(cause)}`);
      })
      .finally(finishInitialization);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [applyEvent]);

  const wrap = useCallback(
    async (
      ownerKey: string,
      operation: () => Promise<BaseSnapshot>
    ) => {
      const expectedOwnerInstance =
        snapshotsRef.current[ownerKey]?.meta.ownerInstanceId ?? null;
      try {
        const snapshot = remember(
          await operation(),
          expectedOwnerInstance
        );
        if (!snapshot) {
          throw new Error(`Base ${ownerKey} 的操作结果来自已移除世代`);
        }
        return snapshot;
      } catch (cause) {
        setWarning(errorMessage(cause));
        throw cause;
      }
    },
    [remember]
  );
  const ensure = useCallback(
    (ownerKey: string) => wrap(ownerKey, () => ensureBase(ownerKey)),
    [wrap]
  );
  const discardCorrupt = useCallback(
    (ownerKey: string) =>
      wrap(ownerKey, () => discardCorruptBase(ownerKey)),
    [wrap]
  );
  const updateMeta = useCallback(
    (input: Parameters<typeof updateBaseMeta>[0]) =>
      wrap(input.ownerKey, () => updateBaseMeta(input)),
    [wrap]
  );
  const insertRows = useCallback(
    (ownerKey: string, rows: BaseRow[], surfaceLeaseId?: string) =>
      wrap(ownerKey, () => insertBaseRows({ ownerKey, rows, surfaceLeaseId })),
    [wrap]
  );
  const patchRow = useCallback(
    (ownerKey: string, rowId: string, patch: BaseRowPatch, surfaceLeaseId?: string) =>
      wrap(ownerKey, () => patchBaseRow({ ownerKey, rowId, patch, surfaceLeaseId })),
    [wrap]
  );
  const deleteRows = useCallback(
    (
      ownerKey: string,
      rowIds: string[],
      expectedRevision: number,
      surfaceLeaseId?: string
    ) =>
      wrap(ownerKey, () =>
        deleteBaseRows({
          ownerKey,
          rowIds,
          expectedRevision,
          surfaceLeaseId,
        })
      ),
    [wrap]
  );
  const importJson = useCallback(
    async (ownerKey: string, expectedRevision: number) => {
      const result = await importBaseJson(ownerKey, expectedRevision);
      if (!result.cancelled) remember(result.snapshot);
      return result;
    },
    [remember]
  );
  const importXlsx = useCallback(
    async (ownerKey: string, expectedRevision: number) => {
      const result = await importBaseXlsx(ownerKey, expectedRevision);
      if (!result.cancelled) remember(result.snapshot);
      return result;
    },
    [remember]
  );

  const value = useMemo<BasesContextValue>(
    () => ({
      snapshots,
      movedOwners,
      pinned,
      projectBases,
      projectBasesLoaded,
      warning,
      get: reload,
      ensure,
      discardCorrupt,
      updateMeta,
      insertRows,
      patchRow,
      deleteRows,
      exportCsv: exportBaseCsv,
      exportJson: exportBaseJson,
      exportXlsx: exportBaseXlsx,
      importJson,
      importXlsx,
      rowHistory: getBaseRowHistory,
      resolveForSection: resolveBaseForSection,
      promoteToProject: promoteBaseToProject,
    }),
    [
      deleteRows,
      discardCorrupt,
      ensure,
      insertRows,
      importJson,
      importXlsx,
      movedOwners,
      patchRow,
      pinned,
      projectBases,
      projectBasesLoaded,
      reload,
      snapshots,
      updateMeta,
      warning,
    ]
  );

  return <BasesContext.Provider value={value}>{children}</BasesContext.Provider>;
}

export function useBases() {
  const context = useContext(BasesContext);
  if (!context) throw new Error("useBases 必须在 BasesProvider 内使用");
  return context;
}
