"use client";

/**
 * [INPUT]: Depends on React Context, the locale catalog, AppsProvider, selectable HistoryProvider Project, import coordinator, shared Projects, and projects-client contracts
 * [OUTPUT]: Provides ProjectsProvider/useProjects with epoch refresh, buffered events, authoritative placement convergence, App focus, localized reveal/detach/missing failures, and Git branch operations
 * [POS]: Renderer Project single source of truth; mutation Promise records never bypass ordered snapshot/event adoption
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
  Project,
  GitBranchSnapshot,
  GitBranchTarget,
  ProjectAppearance,
  ProjectLocalDetachResult,
  SetProjectAppPinnedInput,
  SetProjectAppPinnedResult,
  ProjectsEvent,
  ProjectsSortMode,
} from "../../../shared/projects-ipc";
import { useApps } from "./apps-provider";
import {
  checkoutProjectBranch,
  createProjectBranch,
  detachLocalProject as detachLocalProjectViaClient,
  ensureProjectForApp,
  listProjectBranches,
  listProjects,
  onProjectsEvent,
  releaseMissingProject as releaseMissingProjectViaClient,
  revealProject as revealProjectViaClient,
  renameProject as renameProjectViaClient,
  setProjectAppearance as setProjectAppearanceViaClient,
  setProjectAppPinned as setProjectAppPinnedViaClient,
  setProjectsSortMode,
} from "@/lib/projects-client";
import { errorMessage } from "@/lib/errors";
import { useOptionalHistory } from "./history/history-provider";
import { useAppTranslation } from "./i18n-provider";

type ProjectsContextValue = {
  projects: Project[];
  sortMode: ProjectsSortMode;
  loading: boolean;
  warning: string;
  refresh: () => Promise<void>;
  addProject: () => Promise<Project | null>;
  ensureForApp: (appId: string) => Promise<Project>;
  renameProject: (projectId: string, name: string) => Promise<Project>;
  setProjectAppearance: (
    projectId: string,
    appearance: ProjectAppearance
  ) => Promise<Project>;
  setProjectAppPinned: (
    input: SetProjectAppPinnedInput
  ) => Promise<SetProjectAppPinnedResult>;
  detachLocalProject: (projectId: string) => Promise<ProjectLocalDetachResult>;
  revealProject: (projectId: string) => Promise<void>;
  releaseMissingProject: (projectId: string) => Promise<number>;
  setSortMode: (sortMode: ProjectsSortMode) => Promise<void>;
  listBranches: (projectId: string) => Promise<GitBranchSnapshot | null>;
  checkoutBranch: (
    projectId: string,
    target: GitBranchTarget
  ) => Promise<GitBranchSnapshot>;
  createBranch: (
    projectId: string,
    name: string
  ) => Promise<GitBranchSnapshot>;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

function applyEvents(base: Project[], events: ProjectsEvent[]) {
  const projects = new Map(base.map((project) => [project.id, project]));
  for (const event of events) {
    if (event.type === "upserted") projects.set(event.project.id, event.project);
    if (event.type === "removed") projects.delete(event.projectId);
  }
  return [...projects.values()];
}

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const { t } = useAppTranslation();
  const history = useOptionalHistory();
  const { records } = useApps();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sortMode, setSortModeState] = useState<ProjectsSortMode>("manual");
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState("");
  const epoch = useRef(0);
  const refreshing = useRef(false);
  const bufferedEvents = useRef<ProjectsEvent[]>([]);

  const receive = useCallback((event: ProjectsEvent) => {
    if (refreshing.current) bufferedEvents.current.push(event);
    if (event.type === "warning") setWarning(event.message);
    else if (event.type === "sort-mode") setSortModeState(event.sortMode);
    else setProjects((current) => applyEvents(current, [event]));
  }, []);

  const refresh = useCallback(async () => {
    const currentEpoch = ++epoch.current;
    refreshing.current = true;
    bufferedEvents.current = [];
    try {
      const snapshot = await listProjects();
      if (currentEpoch !== epoch.current) return;
      const buffered = bufferedEvents.current;
      setProjects(applyEvents(snapshot.projects, buffered));
      setSortModeState(
        buffered.reduce(
          (mode, event) => (event.type === "sort-mode" ? event.sortMode : mode),
          snapshot.sortMode
        )
      );
      const warningEvent = buffered.findLast(
        (event): event is Extract<ProjectsEvent, { type: "warning" }> =>
          event.type === "warning"
      );
      setWarning(warningEvent?.message ?? snapshot.warning ?? "");
    } catch (cause) {
      if (currentEpoch === epoch.current) {
        setWarning(
          t("projects.provider.loadFailed", { message: errorMessage(cause) })
        );
      }
    } finally {
      if (currentEpoch === epoch.current) {
        refreshing.current = false;
        bufferedEvents.current = [];
        setLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    const unsubscribe = onProjectsEvent(receive);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    void refresh();
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [receive, refresh]);

  const appsSignature = records
    .map((record) => `${record.id}:${record.state}:${record.dir}`)
    .sort()
    .join("|");
  const previousAppsSignature = useRef(appsSignature);
  useEffect(() => {
    if (previousAppsSignature.current === appsSignature) return;
    previousAppsSignature.current = appsSignature;
    void refresh();
  }, [appsSignature, refresh]);

  const run = useCallback(
    async <T,>(
      action: () => Promise<T>,
      failureCopy: (message: string) => string
    ) => {
      try {
        return await action();
      } catch (cause) {
        setWarning(failureCopy(errorMessage(cause)));
        throw cause;
      }
    },
    []
  );

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      sortMode,
      loading,
      warning,
      refresh,
      addProject: () => run(
        () => history?.addProject() ?? Promise.reject(new Error(t("projects.provider.coordinatorUnavailable"))),
        (message) => t("projects.provider.addFailed", { message })
      ),
      ensureForApp: (appId) =>
        run(
          () => ensureProjectForApp(appId),
          (message) => t("projects.provider.appProjectFailed", { message })
        ),
      renameProject: (projectId, name) =>
        run(
          () => renameProjectViaClient(projectId, name),
          (message) => t("projects.provider.renameFailed", { message })
        ),
      setProjectAppearance: (projectId, appearance) =>
        run(
          () => setProjectAppearanceViaClient(projectId, appearance),
          (message) => t("projects.provider.appearanceFailed", { message })
        ),
      setProjectAppPinned: async (input) => {
        try {
          const result = await setProjectAppPinnedViaClient(input);
          if (!result.changed) await refresh();
          return result;
        } catch (cause) {
          await refresh();
          throw cause;
        }
      },
      detachLocalProject: (projectId) =>
        run(
          () => detachLocalProjectViaClient(projectId),
          (message) => t("projects.provider.detachFailed", { message })
        ),
      revealProject: (projectId) =>
        run(
          () => revealProjectViaClient(projectId),
          (message) => t("projects.provider.revealFailed", { message })
        ),
      releaseMissingProject: (projectId) =>
        run(
          () => releaseMissingProjectViaClient(projectId),
          (message) => t("projects.provider.releaseFailed", { message })
        ),
      setSortMode: async (mode) => {
        await run(
          () => setProjectsSortMode(mode),
          (message) => t("projects.provider.sortFailed", { message })
        );
      },
      listBranches: listProjectBranches,
      checkoutBranch: checkoutProjectBranch,
      createBranch: createProjectBranch,
    }),
    [history, loading, projects, refresh, run, sortMode, t, warning]
  );

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects() {
  const context = useOptionalProjects();
  if (!context) throw new Error("useProjects 必须在 ProjectsProvider 内使用");
  return context;
}

export function useOptionalProjects() {
  return useContext(ProjectsContext);
}
