"use client";

/**
 * [INPUT]: Depends on React lazy/Suspense, shared history-import Agreement with lib/history/client
 * [OUTPUT]: Provides HistoryProvider/useHistory, including event-first watershed, global Project Add flight, switching, refreshing, session renaming/archiving and Memory delta second confirmation
 * [POS]: providers/history external source history and Project onboarding single renderer owner; Sidebar/Composer input is in this merge, asynchronous failure in warning
 */

import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { HistoryImportSnapshot, HistoryMemoryPreview, PreparedProjectHistoryImport, ProjectHistoryCommitResult } from "../../../../shared/history-import-ipc";
import type { Project } from "../../../../shared/projects-ipc";
import {
  commitHistoryProject,
  historySnapshot,
  onHistoryEvent,
  prepareHistoryProject,
  refreshHistoryProject,
  renameHistorySession,
  setHistoryProjectEnabled,
  setHistorySessionArchived,
  commitHistoryMemory,
} from "@/lib/history/client";
import { errorMessage } from "@/lib/errors";

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
  renameSession(opaqueId: string, title: string): Promise<void>;
  setSessionArchived(opaqueId: string, archived: boolean): Promise<void>;
};

const initial: HistoryImportSnapshot = { revision: 0, entries: [], projects: [], memoryDelivering: false, warning: null };
const HistoryContext = createContext<HistoryContextValue | null>(null);

export function HistoryProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState("");
  const [prepared, setPrepared] = useState<PreparedProjectHistoryImport | null>(null);
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

  /* 失败已投影为 warning；入口调用方（Sidebar +、Composer）拿 null 即「未创建」，
     不再向上抛拒绝。 */
  const addProject = useCallback(() => {
    if (addFlight.current) return addFlight.current.promise;
    let resolve!: (project: Project | null) => void;
    const promise = new Promise<Project | null>((done) => { resolve = done; });
    addFlight.current = { promise, resolve };
    void run(prepareHistoryProject)
      .then((next) => {
        if (next) setPrepared(next);
        else {
          addFlight.current?.resolve(null);
          addFlight.current = null;
        }
      })
      .catch(() => {
        addFlight.current?.resolve(null);
        addFlight.current = null;
      });
    return promise;
  }, [run]);

  const completeProject = useCallback((project: Project | null) => {
    setPrepared(null);
    addFlight.current?.resolve(project);
    addFlight.current = null;
  }, []);

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
    /* rename/归档与 setEnabled 同律：mutation 后 main publish snapshot 事件，
       此处不做乐观更新；失败投影为 warning 后仍向上抛，行内边界收敛 busy。 */
    renameSession: (opaqueId, title) => run(() => renameHistorySession(opaqueId, title)),
    setSessionArchived: (opaqueId, archived) => run(() => setHistorySessionArchived(opaqueId, archived)),
  }), [addProject, commitMemory, loading, run, snapshot, warning]);

  return (
    <HistoryContext.Provider value={value}>
      {children}
      {prepared && (
        <Suspense fallback={null}>
          <ProjectImportDialog key={prepared.token} prepared={prepared} onComplete={completeProject} />
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
