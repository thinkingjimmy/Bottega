"use client";

/**
 * [INPUT]: Depends on React lazy/Suspense, shared history-import contracts, lib/history/client, I18n, and the shared toast channel
 * [OUTPUT]: Provides HistoryProvider/useHistory: event-first snapshots, one Project Add flight with preflight counts and automatic empty-project creation, enable/refresh, and Memory confirmation
 * [POS]: The single renderer owner of external history and Project onboarding; presentation actions on a synchronized history belong to the canonical Chat, not here
 */

import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { HISTORY_SOURCE_KINDS, type HistoryImportSnapshot, type HistoryMemoryPreview, type HistorySourceCount, type PreparedProjectHistoryImport, type ProjectHistoryCommitResult } from "../../../../shared/history-import-ipc";
import type { Project } from "../../../../shared/projects-ipc";
import {
  commitHistoryProject,
  countHistoryProject,
  historySnapshot,
  onHistoryEvent,
  prepareHistoryProject,
  refreshHistoryProject,
  setHistoryProjectEnabled,
  commitHistoryMemory,
} from "@/lib/history/client";
import { errorMessage } from "@/lib/errors";
import { useAppTranslation } from "../i18n-provider";
import { toast } from "@ai-chat/ui/components/ui/sonner";

const ProjectImportDialog = lazy(() =>
  import("@/components/sidebar/project/import/project-import-dialog").then((module) => ({
    default: module.ProjectImportDialog,
  }))
);
const HistoryMemoryPreviewDialog = lazy(() =>
  import("./memory-preview-dialog").then((module) => ({
    default: module.HistoryMemoryPreviewDialog,
  }))
);

type HistoryContextValue = {
  snapshot: HistoryImportSnapshot;
  loading: boolean;
  warning: string;
  addProject(): Promise<Project | null>;
  commitProject(input: { token: string; importHistory: boolean; previewMemory: boolean }): Promise<ProjectHistoryCommitResult>;
  commitMemory(snapshotId: string, digest: string): Promise<void>;
  setEnabled(projectId: string, enabled: boolean): Promise<void>;
  refreshProject(projectId: string): Promise<void>;
};

const initial: HistoryImportSnapshot = { revision: 0, entries: [], canonicalRoutes: {}, projects: [], memoryDelivering: false, warning: null };
const HistoryContext = createContext<HistoryContextValue | null>(null);

export function HistoryProvider({ children }: { children: React.ReactNode }) {
  const { t } = useAppTranslation();
  const [snapshot, setSnapshot] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState("");
  const [confirmation, setConfirmation] = useState<{
    prepared: PreparedProjectHistoryImport;
    counts: HistorySourceCount[];
  } | null>(null);
  const [refreshPreview, setRefreshPreview] = useState<HistoryMemoryPreview | null>(null);
  const addFlight = useRef<{
    promise: Promise<Project | null>;
    resolve(project: Project | null): void;
  } | null>(null);
  const buffered = useRef<HistoryImportSnapshot[]>([]);
  const hydrating = useRef(true);

  /* mutation 之后不再手动重拉：main 在每次 setEnabled/commit/refresh 后都
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
      setWarning(errorMessage(cause));
      throw cause;
    }
  }, []);

  const completeProject = useCallback((project: Project | null) => {
    setConfirmation(null);
    addFlight.current?.resolve(project);
    addFlight.current = null;
  }, []);

  /* 四个来源都明确为零才跳过确认；扫描失败或缺少来源回执都保留选择。
     扫描使用非阻塞进度提示，Sidebar 与 Composer 共享同一次添加。 */
  const addProject = useCallback(() => {
    if (addFlight.current) return addFlight.current.promise;
    let resolve!: (project: Project | null) => void;
    const promise = new Promise<Project | null>((done) => { resolve = done; });
    addFlight.current = { promise, resolve };
    void run(async () => {
      const prepared = await prepareHistoryProject();
      if (!prepared) return completeProject(null);
      const progress = toast.loading(t("history.projectScanningDescription"));
      try {
        const counts = await countHistoryProject(prepared.token).catch(() => []);
        const empty = HISTORY_SOURCE_KINDS.every((kind) =>
          counts.find((item) => item.sourceKind === kind)?.count === 0
        );
        if (!empty) {
          setConfirmation({ prepared, counts });
          return;
        }
        const { project } = await commitHistoryProject({
          token: prepared.token,
          importHistory: false,
          previewMemory: false,
        });
        completeProject(project);
      } finally {
        toast.dismiss(progress);
      }
    }).catch(() => completeProject(null));
    return promise;
  }, [completeProject, run, t]);

  const commitMemory = useCallback(
    (snapshotId: string, digest: string) => run(() => commitHistoryMemory(snapshotId, digest)),
    [run]
  );

  const value = useMemo<HistoryContextValue>(() => ({
    snapshot,
    loading,
    warning,
    addProject,
    commitProject: (input) => run(() => commitHistoryProject(input)),
    commitMemory,
    setEnabled: async (projectId, enabled) => {
      await run(() => setHistoryProjectEnabled(projectId, enabled)).catch(() => {});
    },
    refreshProject: async (projectId) => {
      const result = await run(() => refreshHistoryProject(projectId)).catch(() => null);
      setRefreshPreview(result?.memoryPreview ?? null);
    },
  }), [addProject, commitMemory, loading, run, snapshot, warning]);

  return (
    <HistoryContext.Provider value={value}>
      {children}
      {confirmation && (
        <Suspense fallback={null}>
          <ProjectImportDialog
            key={confirmation.prepared.token}
            prepared={confirmation.prepared}
            counts={confirmation.counts}
            onComplete={completeProject}
          />
        </Suspense>
      )}
      {refreshPreview && (
        <Suspense fallback={null}>
          <HistoryMemoryPreviewDialog
            preview={refreshPreview}
            onClose={() => setRefreshPreview(null)}
            onCommit={commitMemory}
          />
        </Suspense>
      )}
    </HistoryContext.Provider>
  );
}

export function useHistory() {
  const value = useContext(HistoryContext);
  if (!value) throw new Error("useHistory 必须在 HistoryProvider 内使用");
  return value;
}

export const useOptionalHistory = () => useContext(HistoryContext);
