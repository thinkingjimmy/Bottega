"use client";

/**
 * [INPUT]: Depends on React Context, AppsProvider, selectable HistoryProvider Project, import coordinator, shared Projects, contracts with projects-client
 * [OUTPUT]: Provides ProjectsProvider/useProjects, including epoch refresh, event buffer, App signature and window focus, invalid refresh, Project non-destructive detach/look/workspace chooser/missing, rescue and Git branch query/switch/create
 * [POS]: Project's single source of truth, driven by Path Guards, Sidebar, App Editors, and New Task selectors
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
  ProjectMemoryRebindMode,
  ProjectsEvent,
  ProjectsSortMode,
} from "../../../shared/projects-ipc";
import { useApps } from "./apps-provider";
import {
  checkoutProjectBranch,
  chooseProjectWorkspaceBinding,
  createProjectBranch,
  detachLocalProject as detachLocalProjectViaClient,
  ensureProjectForApp,
  listProjectBranches,
  listProjects,
  onProjectsEvent,
  releaseMissingProject as releaseMissingProjectViaClient,
  renameProject as renameProjectViaClient,
  setProjectAppearance as setProjectAppearanceViaClient,
  setProjectsSortMode,
} from "@/lib/projects-client";
import { errorMessage } from "@/lib/errors";
import { useOptionalHistory } from "./history/history-provider";

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
  detachLocalProject: (projectId: string) => Promise<ProjectLocalDetachResult>;
  chooseWorkspaceBinding: (
    projectId: string,
    mode: ProjectMemoryRebindMode
  ) => Promise<Project | null>;
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
        setWarning(`Projects 加载失败：${errorMessage(cause)}`);
      }
    } finally {
      if (currentEpoch === epoch.current) {
        refreshing.current = false;
        bufferedEvents.current = [];
        setLoading(false);
      }
    }
  }, []);

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
    async <T,>(action: () => Promise<T>, label: string) => {
      try {
        return await action();
      } catch (cause) {
        setWarning(`${label}：${errorMessage(cause)}`);
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
        () => history?.addProject() ?? Promise.reject(new Error("Project 导入协调器尚未挂载")),
        "Project 添加失败"
      ),
      ensureForApp: (appId) =>
        run(() => ensureProjectForApp(appId), "App Project 建立失败"),
      renameProject: (projectId, name) =>
        run(() => renameProjectViaClient(projectId, name), "Project 重命名失败"),
      setProjectAppearance: (projectId, appearance) =>
        run(
          () => setProjectAppearanceViaClient(projectId, appearance),
          "Project 外观保存失败"
        ),
      detachLocalProject: (projectId) =>
        run(
          () => detachLocalProjectViaClient(projectId),
          "Project 本地移除失败"
        ),
      chooseWorkspaceBinding: (projectId, mode) =>
        run(
          () => chooseProjectWorkspaceBinding(projectId, mode),
          "Project 工作目录选择失败"
        ),
      releaseMissingProject: (projectId) =>
        run(
          () => releaseMissingProjectViaClient(projectId),
          "聊天移回根级失败"
        ),
      setSortMode: async (mode) => {
        await run(() => setProjectsSortMode(mode), "Project 排序保存失败");
      },
      listBranches: listProjectBranches,
      checkoutBranch: checkoutProjectBranch,
      createBranch: createProjectBranch,
    }),
    [history, loading, projects, refresh, run, sortMode, warning]
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
