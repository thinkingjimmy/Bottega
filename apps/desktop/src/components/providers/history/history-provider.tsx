"use client";

/**
 * [INPUT]: Depends on React lazy/Suspense, shared history-import contracts, installed Agent picker policy, backend facts, lib/history/client, and the shared toast channel
 * [OUTPUT]: Provides HistoryProvider/useHistory with shared Project Add and explicit Settings imports, preflight counts, single-flight operations, empty-result dialogs, and caller-owned Memory confirmation errors
 * [POS]: The single renderer owner of external history and Project onboarding; presentation actions on a synchronized history belong to the canonical Chat, not here
 */

import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { historyScanIsEmpty, type HistoryImportSnapshot, type HistoryMemoryPreview, type HistorySourceCount, type HistorySourceKind } from "../../../../shared/ipc/content/history-import-ipc";
import type { Project } from "../../../../shared/ipc/workspace/projects-ipc";
import {
  commitHistoryProject,
  countHistoryProject,
  historySnapshot,
  onHistoryEvent,
  prepareHistoryProject,
  prepareProjectHistoryImport,
  importProjectHistory,
} from "@/lib/history/client";
import { installedHistorySources } from "@/lib/agent/picker/presentation";
import { listBackends } from "@/lib/settings/client/settings-client";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { toast } from "@ai-chat/ui/components/ui/sonner";

const ProjectImportDialog = lazy(() =>
  import("@/components/sidebar/project/import/project-import-dialog").then((module) => ({
    default: module.ProjectImportDialog,
  }))
);

/* 选定文件夹到这次添加落定之间的那个 Project：它还不是成员，但已经有名字和位置。
   scanning 只在预检计数还没回来时为真——弹窗打开后没有什么在跑，占位行不该再转。 */
export type PendingProject = { name: string; canonicalRoot: string; scanning: boolean };

type HistoryContextValue = {
  snapshot: HistoryImportSnapshot;
  loading: boolean;
  warning: string;
  pendingProject: PendingProject | null;
  addProject(): Promise<Project | null>;
  importProject(project: Project): Promise<void>;
  importingProjectId: string | null;
};

const initial: HistoryImportSnapshot = { revision: 0, entries: [], canonicalRoutes: {}, projects: [], memoryDelivering: false, warning: null };
const HistoryContext = createContext<HistoryContextValue | null>(null);

export function HistoryProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState("");
  const [pendingProject, setPendingProject] = useState<PendingProject | null>(null);
  const [confirmation, setConfirmation] = useState<{
    canonicalRoot: string;
    counts: HistorySourceCount[];
    sourceKinds: HistorySourceKind[];
    mode: "add" | "import";
    onCommit(importHistory: boolean, previewMemory: boolean): Promise<HistoryMemoryPreview | null>;
    onComplete(): void;
  } | null>(null);
  const [importingProjectId, setImportingProjectId] = useState<string | null>(null);
  const importFlight = useRef<Promise<void> | null>(null);
  const addFlight = useRef<{
    promise: Promise<Project | null>;
    resolve(project: Project | null): void;
  } | null>(null);
  const buffered = useRef<HistoryImportSnapshot[]>([]);
  const hydrating = useRef(true);

  /* mutation 之后不再手动重拉：main 在每次明确的添加/导入后都
     publish snapshot 事件，事件流按 revision 单调收敛是唯一权威。 */
  useEffect(() => {
    const unsubscribe = onHistoryEvent((event) => {
      if (event.type === "snapshot") {
        if (hydrating.current) buffered.current.push(event.snapshot);
        setSnapshot((current) => event.snapshot.revision >= current.revision ? event.snapshot : current);
        setWarning(event.snapshot.warning ?? "");
        return;
      }
      setSnapshot((current) => ({
        ...current,
        projects: current.projects.map((project) => project.projectId === event.project.projectId ? event.project : project),
      }));
    });
    void (async () => {
      try {
        const baseline = await historySnapshot();
        const newest = buffered.current.reduce(
          (current, candidate) => candidate.revision > current.revision ? candidate : current,
          baseline
        );
        setSnapshot((current) => newest.revision >= current.revision ? newest : current);
        setWarning(newest.warning ?? "");
      } catch (cause) {
        setWarning(errorMessage(cause));
      } finally {
        hydrating.current = false;
        buffered.current = [];
        setLoading(false);
      }
    })();
    return unsubscribe;
  }, []);

  const run = useCallback(async <T,>(action: () => Promise<T>) => {
    try {
      return await action();
    } catch (cause) {
      toast.error(errorMessage(cause));
      throw cause;
    }
  }, []);

  const completeProject = useCallback((project: Project | null) => {
    setConfirmation(null);
    setPendingProject(null);
    addFlight.current?.resolve(project);
    addFlight.current = null;
  }, []);

  /* 四个来源都明确为零才跳过确认；扫描失败或缺少来源回执都保留选择。
     等待不走通知通道：选定文件夹起，pendingProject 就站在侧栏它将来的位置
     （超过门槛才显形），Sidebar 与 Composer 共享同一次添加。 */
  const addProject = useCallback(() => {
    if (addFlight.current) return addFlight.current.promise;
    if (importFlight.current) return importFlight.current.then(() => null);
    let resolve!: (project: Project | null) => void;
    const promise = new Promise<Project | null>((done) => { resolve = done; });
    addFlight.current = { promise, resolve };
    void run(async () => {
      const sourceKinds = installedHistorySources(await listBackends());
      const prepared = await prepareHistoryProject(sourceKinds);
      if (!prepared) return completeProject(null);
      const pending = { name: prepared.name, canonicalRoot: prepared.canonicalRoot };
      setPendingProject({ ...pending, scanning: true });
      const counts = await countHistoryProject(prepared.token).catch(() => []);
      const empty = historyScanIsEmpty(counts, sourceKinds);
      if (!empty) {
        setPendingProject({ ...pending, scanning: false });
        let created: Project | null = null;
        setConfirmation({
          canonicalRoot: prepared.canonicalRoot, counts, sourceKinds, mode: "add",
          onCommit: async (importHistory, previewMemory) => {
            const result = await commitHistoryProject({ token: prepared.token, importHistory, previewMemory });
            created = result.project;
            return result.memoryPreview;
          },
          onComplete: () => completeProject(created),
        });
        return;
      }
      const { project } = await commitHistoryProject({
        token: prepared.token,
        importHistory: false,
        previewMemory: false,
      });
      completeProject(project);
    }).catch(() => completeProject(null));
    return promise;
  }, [completeProject, run]);

  const importProject = useCallback((project: Project) => {
    if (importFlight.current) return importFlight.current;
    if (addFlight.current) return addFlight.current.promise.then(() => undefined);
    let complete!: () => void;
    const promise = new Promise<void>((resolve) => { complete = resolve; });
    importFlight.current = promise;
    setImportingProjectId(project.id);
    const finish = () => {
      setConfirmation(null);
      setImportingProjectId(null);
      importFlight.current = null;
      complete();
    };
    void run(async () => {
      const sourceKinds = installedHistorySources(await listBackends());
      const preview = await prepareProjectHistoryImport({ projectId: project.id, sourceKinds });
      setConfirmation({
        canonicalRoot: project.dir, counts: preview.counts, sourceKinds, mode: "import",
        onCommit: async (_importHistory, previewMemory) => {
          const result = await importProjectHistory({ projectId: project.id, membershipRevision: preview.membershipRevision, previewMemory, sourceKinds });
          return result.memoryPreview;
        },
        onComplete: finish,
      });
    }).catch(finish);
    return promise;
  }, [run]);

  const value = useMemo<HistoryContextValue>(() => ({
    snapshot,
    loading,
    warning,
    pendingProject,
    addProject,
    importProject,
    importingProjectId,
  }), [addProject, importingProjectId, importProject, loading, pendingProject, snapshot, warning]);

  return (
    <HistoryContext.Provider value={value}>
      {children}
      {confirmation && (
        <Suspense fallback={null}>
          <ProjectImportDialog
            key={`${confirmation.mode}:${confirmation.canonicalRoot}`}
            {...confirmation}
          />
        </Suspense>
      )}
    </HistoryContext.Provider>
  );
}

export function useHistory() {
  const value = useContext(HistoryContext);
  if (!value) throw new Error("useHistory must be used within HistoryProvider");
  return value;
}

export const useOptionalHistory = () => useContext(HistoryContext);
