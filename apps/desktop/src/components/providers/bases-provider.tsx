"use client";

/**
 * [INPUT]: Depends on React Context, the locale catalog, shared BaseOwner changed/moved/removed Event rules, and lib/bases client
 * [OUTPUT]: Provides BasesProvider plus the split useBasesNavigation/useBaseSnapshots hooks, bounded move/retire ledgers, an explicit Project Base baseline-loaded fence, and revision-bound Base commands
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
  BaseNavigationSummary,
  BaseRow,
  BaseRowPatch,
  BasesEvent,
  BaseSnapshot,
} from "../../../shared/bases-ipc";
import { ownerFromKey, ownerKeyOf } from "../../../shared/bases-ipc";
import {
  appearsInProjectBase,
  appearsInRootBases,
} from "../../../shared/placement/base";
import {
  deleteBaseRows,
  ensureBase,
  exportBaseCsv,
  exportBaseJson,
  exportBaseXlsx,
  getBase,
  getBaseRowHistory,
  insertBaseRows,
  importBaseJson,
  importBaseXlsx,
  listRootBases,
  listProjectBases,
  onBasesEvent,
  patchBaseRow,
  promoteBaseToProject,
  removeManagedBase,
  resolveBaseForSection,
  updateBaseMeta,
} from "@/lib/bases/client";
import { errorMessage } from "@/lib/errors";
import { useAppTranslation } from "./i18n-provider";

/* ============================================================================
 * 为什么是两个 Context 而不是一个
 *
 * 侧栏只关心「有哪些 Base、它们叫什么」；Workbench 关心「这一张表此刻的
 * 每一行」。合成一个值时，任何一次单元格编辑都会让侧栏、Project 设置页、
 * 面板 tab 条一起重渲染——它们读到的东西一个字都没变。切成导航相与快照相
 * 之后，行事件只推动真正读行的那批消费者。
 * 需要两者的组件（Workbench、头部动作）各调一次 hook，而不是由 Provider
 * 每次渲染合成一个新对象把这份隔离又还回去。
 * ========================================================================== */
type BasesNavigationValue = {
  movedOwners: Readonly<Record<string, string>>;
  rootBases: BaseNavigationSummary[];
  projectBases: BaseNavigationSummary[];
  projectBasesLoaded: boolean;
  warning: string;
  ensure(ownerKey: string): Promise<BaseSnapshot>;
  removeManaged(ownerKey: string, ownerInstanceId: string): Promise<boolean>;
  resolveForSection: typeof resolveBaseForSection;
  promoteToProject: typeof promoteBaseToProject;
};

type BaseSnapshotsValue = {
  snapshots: Readonly<Record<string, BaseSnapshot>>;
  get(ownerKey: string): Promise<BaseSnapshot | null>;
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
};

const BasesNavigationContext = createContext<BasesNavigationValue | null>(null);
const BaseSnapshotsContext = createContext<BaseSnapshotsValue | null>(null);

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

/* 转发表与墓碑表都随会话生长，故都必须有上界：它们服务的是「刚刚发生的
   那次搬迁/删除」，一个长跑的窗口里攒下几千条陈年记录只会白占内存。
   两者都按插入序淘汰最旧的一条。 */
const MOVED_OWNER_LIMIT = 64;
const RETIRED_OWNER_LIMIT = 128;

const retiredKey = (ownerKey: string, ownerInstanceId: string) =>
  `${ownerKey}\u0000${ownerInstanceId}`;

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

/**
 * 记住一次搬迁，并保持转发表有界。旧键不能在目标落地时就删——用户可能仍站在
 * 旧路由上，转发表正是那一刻唯一能把他带到新 Base 的东西；故按容量淘汰。
 */
export function rememberMovedOwner(
  current: Readonly<Record<string, string>>,
  from: string,
  to: string
): Record<string, string> {
  const next = { ...current, [from]: to };
  const keys = Object.keys(next);
  for (let index = 0; index + MOVED_OWNER_LIMIT < keys.length; index += 1) {
    delete next[keys[index]!];
  }
  return next;
}

export function requestBaseReload(
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
  event: Extract<BasesEvent, { type: "base-changed" }>,
  failureCopy: (values: { ownerKey: string; message: string }) => string
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
    return failureCopy({
      ownerKey: event.ownerKey,
      message: errorMessage(cause),
    });
  }
}

function sortSummaries(values: Iterable<BaseNavigationSummary>) {
  return [...values].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.ownerKey.localeCompare(right.ownerKey)
  );
}

/* 导航清单的内容相等即身份相等：一次不影响清单的行编辑不该让侧栏重渲染。
   navigation 不参与比较——它住在 meta 里，改动必然抬高 revision。 */
function sameSummaries(
  left: readonly BaseNavigationSummary[],
  right: readonly BaseNavigationSummary[]
) {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index]!;
      return (
        item.ownerKey === other.ownerKey &&
        item.ownerInstanceId === other.ownerInstanceId &&
        item.name === other.name &&
        item.revision === other.revision
      );
    })
  );
}

function summaryOf(snapshot: BaseSnapshot): BaseNavigationSummary {
  return {
    ownerKey: ownerKeyOf(snapshot.meta.owner),
    ownerInstanceId: snapshot.meta.ownerInstanceId,
    name: snapshot.meta.name,
    revision: snapshot.meta.revision,
    navigation: snapshot.meta.navigation,
  };
}

/** 一份 summary 只被判读一次：root 清单与 project 清单是同一个 navigation 的两个答案。 */
function placeSummary(
  summary: BaseNavigationSummary,
  root: Map<string, BaseNavigationSummary>,
  project: Map<string, BaseNavigationSummary>
) {
  const navigation = summary.navigation;
  if (appearsInRootBases(navigation)) root.set(summary.ownerKey, summary);
  else root.delete(summary.ownerKey);
  if (
    navigation.kind === "project-contained" &&
    appearsInProjectBase(navigation, navigation.projectId)
  ) {
    project.set(summary.ownerKey, summary);
  } else {
    project.delete(summary.ownerKey);
  }
}

export function BasesProvider({ children }: { children: React.ReactNode }) {
  const { t } = useAppTranslation();
  const [snapshots, setSnapshots] = useState<Record<string, BaseSnapshot>>({});
  const [movedOwners, setMovedOwners] = useState<Record<string, string>>({});
  const [rootBases, setRootBases] = useState<BaseNavigationSummary[]>([]);
  const [projectBases, setProjectBases] = useState<BaseNavigationSummary[]>([]);
  const [projectBasesLoaded, setProjectBasesLoaded] = useState(false);
  const [warning, setWarning] = useState("");
  const snapshotsRef = useRef<Record<string, BaseSnapshot>>({});
  const rootBasesRef = useRef(new Map<string, BaseNavigationSummary>());
  const projectBasesRef = useRef(new Map<string, BaseNavigationSummary>());
  const retiredRef = useRef(new Set<string>());
  const initializingRef = useRef(true);
  const bufferedEventsRef = useRef<BasesEvent[]>([]);
  const reloadFlightsRef = useRef(new Map<string, BaseReloadFlight>());
  /* 文案取「说这句话的那一刻」的语言，故走 ref：让 t 进订阅 effect 的依赖，
     等于每次切换语言都退订、重订、重跑两条清单 IPC——语言与事件流无关。
     取用时一律先落成局部 t，i18n 门禁按 t(key) 这一种写法认目录引用。 */
  const translateRef = useRef(t);
  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  const publishSummaries = useCallback(() => {
    setRootBases((current) => {
      const next = sortSummaries(rootBasesRef.current.values());
      return sameSummaries(current, next) ? current : next;
    });
    setProjectBases((current) => {
      const next = sortSummaries(projectBasesRef.current.values());
      return sameSummaries(current, next) ? current : next;
    });
  }, []);

  /** 退役一个 owner instance：迟到的 snapshot 不得复活它。表按容量淘汰。 */
  const retire = useCallback((ownerKey: string, ownerInstanceId: string) => {
    const key = retiredKey(ownerKey, ownerInstanceId);
    retiredRef.current.delete(key);
    retiredRef.current.add(key);
    for (const oldest of retiredRef.current) {
      if (retiredRef.current.size <= RETIRED_OWNER_LIMIT) break;
      retiredRef.current.delete(oldest);
    }
  }, []);

  const remember = useCallback((
    snapshot: BaseSnapshot,
    expectedOwnerInstance?: string | null
  ): BaseSnapshot | null => {
    const ownerKey = ownerKeyOf(snapshot.meta.owner);
    if (
      retiredRef.current.has(
        retiredKey(ownerKey, snapshot.meta.ownerInstanceId)
      )
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
    placeSummary(
      summaryOf(merged),
      rootBasesRef.current,
      projectBasesRef.current
    );
    publishSummaries();
    return merged;
  }, [publishSummaries]);

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
      const t = translateRef.current;
      const reloadWarning = await reloadBaseEvent(reload, event, (values) =>
        t("bases.provider.reloadFailed", values)
      );
      if (reloadWarning) setWarning(reloadWarning);
    },
    [reload]
  );

  const applyEvent = useCallback(
    (event: BasesEvent) => {
      if (event.type === "warning") return setWarning(event.message);
      if (event.type === "removed") {
        retire(event.ownerKey, event.ownerInstanceId);
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
          rootBasesRef.current.get(event.ownerKey)?.ownerInstanceId ===
          event.ownerInstanceId
        ) {
          rootBasesRef.current.delete(event.ownerKey);
        }
        if (
          projectBasesRef.current.get(event.ownerKey)?.ownerInstanceId ===
          event.ownerInstanceId
        ) {
          projectBasesRef.current.delete(event.ownerKey);
        }
        publishSummaries();
        return;
      }
      if (event.type === "base-moved") {
        const moved = moveBaseSnapshot(snapshotsRef.current, event);
        if (!moved.applied) return;
        retire(event.from.ownerKey, event.from.ownerInstanceId);
        const next = moved.snapshots;
        snapshotsRef.current = next;
        setSnapshots(next);
        setMovedOwners((current) =>
          rememberMovedOwner(current, event.from.ownerKey, event.to.ownerKey)
        );
        rootBasesRef.current.delete(event.from.ownerKey);
        projectBasesRef.current.delete(event.from.ownerKey);
        publishSummaries();
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
    [handleReloadEvent, publishSummaries, reload, remember, retire]
  );

  useEffect(() => {
    let active = true;
    initializingRef.current = true;
    bufferedEventsRef.current = [];
    /* 桥缺席是装配错误，不是一种可运行的模式：这里只保证渲染树不当场崩塌，
       原因本身由紧随其后的两条清单 IPC 以同一条 warning 路径说出来。 */
    let unsubscribe = () => {};
    try {
      unsubscribe = onBasesEvent((event) => {
        if (!active) return;
        if (initializingRef.current) {
          bufferedEventsRef.current.push(event);
          return;
        }
        applyEvent(event);
      });
    } catch {
      // 清单 IPC 会以同一个原因失败并落到 warning
    }
    const finishInitialization = () => {
      if (!active) return;
      initializingRef.current = false;
      setProjectBasesLoaded(true);
      const buffered = bufferedEventsRef.current;
      bufferedEventsRef.current = [];
      buffered.forEach(applyEvent);
    };
    void Promise.all([listRootBases(), listProjectBases()])
      .then(([result, projectResult]) => {
        if (!active) return;
        const baseline = new Map(
          result.bases.map((item) => [item.ownerKey, item])
        );
        const projectBaseline = new Map(
          projectResult.bases.map((item) => [item.ownerKey, item])
        );
        /* 已在手的 snapshot 永远压过清单：它更新，且判读规则与 remember 同一份。 */
        for (const snapshot of Object.values(snapshotsRef.current)) {
          placeSummary(summaryOf(snapshot), baseline, projectBaseline);
        }
        for (const summaries of [baseline, projectBaseline]) {
          for (const [ownerKey, summary] of summaries) {
            if (
              retiredRef.current.has(
                retiredKey(ownerKey, summary.ownerInstanceId)
              )
            ) {
              summaries.delete(ownerKey);
            }
          }
        }
        rootBasesRef.current = baseline;
        projectBasesRef.current = projectBaseline;
        publishSummaries();
      })
      .catch((cause) => {
        const t = translateRef.current;
        if (active) {
          setWarning(
            t("bases.provider.loadFailed", { message: errorMessage(cause) })
          );
        }
      })
      .finally(finishInitialization);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [applyEvent, publishSummaries]);

  const wrap = useCallback(
    async (
      ownerKey: string,
      operation: () => Promise<BaseSnapshot>
    ) => {
      const t = translateRef.current;
      const expectedOwnerInstance =
        snapshotsRef.current[ownerKey]?.meta.ownerInstanceId ?? null;
      try {
        const snapshot = remember(
          await operation(),
          expectedOwnerInstance
        );
        if (!snapshot) {
          throw new Error(t("bases.provider.retiredResult", { ownerKey }));
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
  const removeManaged = useCallback(
    async (ownerKey: string, ownerInstanceId: string) => {
      try {
        return (await removeManagedBase({ ownerKey, ownerInstanceId })).removed;
      } catch (cause) {
        setWarning(errorMessage(cause));
        throw cause;
      }
    },
    []
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

  const navigation = useMemo<BasesNavigationValue>(
    () => ({
      movedOwners,
      rootBases,
      projectBases,
      projectBasesLoaded,
      warning,
      ensure,
      removeManaged,
      resolveForSection: resolveBaseForSection,
      promoteToProject: promoteBaseToProject,
    }),
    [
      ensure,
      movedOwners,
      projectBases,
      projectBasesLoaded,
      removeManaged,
      rootBases,
      warning,
    ]
  );

  const snapshotsValue = useMemo<BaseSnapshotsValue>(
    () => ({
      snapshots,
      get: reload,
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
    }),
    [
      deleteRows,
      insertRows,
      importJson,
      importXlsx,
      patchRow,
      reload,
      snapshots,
      updateMeta,
    ]
  );

  return (
    <BasesNavigationContext.Provider value={navigation}>
      <BaseSnapshotsContext.Provider value={snapshotsValue}>
        {children}
      </BaseSnapshotsContext.Provider>
    </BasesNavigationContext.Provider>
  );
}

export function useBasesNavigation() {
  const context = useContext(BasesNavigationContext);
  if (!context) throw new Error("useBasesNavigation 必须在 BasesProvider 内使用");
  return context;
}

export function useBaseSnapshots() {
  const context = useContext(BaseSnapshotsContext);
  if (!context) throw new Error("useBaseSnapshots 必须在 BasesProvider 内使用");
  return context;
}
