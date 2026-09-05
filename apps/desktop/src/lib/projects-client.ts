/**
 * [INPUT]: Depends on shared/projects-ipc and preload exposed window.projects
 * [OUTPUT]: Provides Project list/rename/reveal/placement Pin/non-destructive detach/recovery/sort, Git branch commands, events, and a lifecycle-revisioned browser fallback
 * [POS]: Sole renderer Projects IPC adapter; providers and components remain unaware of the Electron bridge
 */

import type {
  Project,
  GitBranchTarget,
  ProjectAppearance,
  SetProjectAppPinnedInput,
  SetProjectAppPinnedResult,
  ProjectsBridgeApi,
  ProjectsEvent,
  ProjectsSnapshot,
  ProjectsSortMode,
} from "../../shared/projects-ipc";
import { appIdFromBinding } from "../../shared/projects-ipc";

declare global {
  interface Window {
    projects?: ProjectsBridgeApi;
  }
}

const browserProjects = new Map<string, Project>();
const browserListeners = new Set<(event: ProjectsEvent) => void>();
let browserSortMode: ProjectsSortMode = "manual";
const emit = (event: ProjectsEvent) => {
  for (const listener of browserListeners) listener(structuredClone(event));
};

export const listProjects = (): Promise<ProjectsSnapshot> =>
  window.projects?.list() ??
  Promise.resolve({
    projects: [...browserProjects.values()].map((value) => structuredClone(value)),
    sortMode: browserSortMode,
  });

export const ensureProjectForApp = async (appId: string) => {
  if (window.projects) return window.projects.ensureForApp(appId);
  const existing = [...browserProjects.values()].find(
    (project) => appIdFromBinding(project) === appId
  );
  if (existing) return structuredClone(existing);
  const now = Date.now();
  const project: Project = {
    id: `project_${appId}`.slice(0, 64),
    name: appId,
    dir: "",
    workspaceBinding: { kind: "app", appId },
    grants: [],
    appPlacements: [],
    grantRevision: 0,
    membershipRevision: 0,
    projectLifecycleRevision: 1,
    sortIndex: browserProjects.size,
    createdAt: now,
    updatedAt: now,
    missing: false,
  };
  browserProjects.set(project.id, project);
  emit({ type: "upserted", project });
  return structuredClone(project);
};

export const renameProject = async (projectId: string, name: string) => {
  if (window.projects) return window.projects.rename(projectId, name);
  const current = browserProjects.get(projectId);
  if (!current) throw new Error("Project 不存在");
  const project = { ...current, name, updatedAt: Date.now() };
  browserProjects.set(projectId, project);
  emit({ type: "upserted", project });
  return structuredClone(project);
};

export const setProjectAppearance = async (
  projectId: string,
  appearance: ProjectAppearance
) => {
  if (window.projects) {
    return window.projects.setAppearance(projectId, appearance);
  }
  const current = browserProjects.get(projectId);
  if (!current) throw new Error("Project 不存在");
  /* 与主进程同构：外观写入不动 updatedAt，否则浏览器降级下的排序会与 Electron 分叉。 */
  const project = { ...current, appearance };
  browserProjects.set(projectId, project);
  emit({ type: "upserted", project });
  return structuredClone(project);
};

export const setProjectAppPinned = async (
  input: SetProjectAppPinnedInput
): Promise<SetProjectAppPinnedResult> => {
  if (window.projects) return window.projects.setAppPinned(input);
  const current = browserProjects.get(input.projectId);
  if (!current) throw new Error("Project 不存在");
  if (current.projectLifecycleRevision !== input.expectedProjectLifecycleRevision) {
    throw new Error("Project lifecycle 已变更");
  }
  const existing = current.appPlacements.find(
    (placement) => placement.appId === input.appId
  );
  if (Boolean(existing) === input.pinned) {
    return { project: structuredClone(current), changed: false };
  }
  const project: Project = {
    ...current,
    appPlacements: input.pinned
      ? [...current.appPlacements, { appId: input.appId, pinnedAt: Date.now() }]
      : current.appPlacements.filter(
          (placement) => placement.appId !== input.appId
        ),
  };
  browserProjects.set(project.id, project);
  emit({ type: "upserted", project });
  return { project: structuredClone(project), changed: true };
};

export const detachLocalProject = (projectId: string) => {
  if (!window.projects) {
    return Promise.reject(new Error("桌面环境不可用，Project 未移除"));
  }
  return window.projects.detachLocal(projectId);
};

export const revealProject = (projectId: string) => {
  if (!window.projects) {
    return Promise.reject(new Error("当前环境不支持系统目录定位"));
  }
  return window.projects.reveal(projectId);
};

export const releaseMissingProject = async (projectId: string) => {
  if (window.projects) return window.projects.releaseMissing(projectId);
  browserProjects.delete(projectId);
  emit({ type: "removed", projectId });
  return 0;
};

export const setProjectsSortMode = async (sortMode: ProjectsSortMode) => {
  if (window.projects) return window.projects.setSortMode(sortMode);
  browserSortMode = sortMode;
  emit({ type: "sort-mode", sortMode });
  return sortMode;
};

export const listProjectBranches = (
  projectId: string,
  conversationId?: string
) => window.projects?.listBranches(projectId, conversationId) ?? Promise.resolve(null);

export const checkoutProjectBranch = (
  projectId: string,
  target: GitBranchTarget
) => {
  if (window.projects) return window.projects.checkoutBranch(projectId, target);
  return Promise.reject(new Error("仅 Electron 支持 Git branch 操作"));
};

export const createProjectBranch = (projectId: string, name: string) => {
  if (window.projects) return window.projects.createBranch(projectId, name);
  return Promise.reject(new Error("仅 Electron 支持 Git branch 操作"));
};

export const onProjectsEvent = (callback: (event: ProjectsEvent) => void) => {
  if (window.projects) return window.projects.onEvent(callback);
  browserListeners.add(callback);
  return () => browserListeners.delete(callback);
};
