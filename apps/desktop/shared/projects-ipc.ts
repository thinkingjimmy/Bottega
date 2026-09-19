/**
 * [INPUT]: No runtime dependencies; only a type-only import of AppGrantRecord from apps-ipc
 * [OUTPUT]: Project IPC contracts, display-only cloud origin and local lifecycle/binding projections.
 * [POS]: Shared Project wire truth; projectLifecycleRevision fences incarnation/deletion, reveal carries only Project ID, and appPlacements express navigation without granting App capability
 */

import type { AppGrantRecord } from "./apps-ipc";

export type ProjectsSortMode = "last-updated" | "manual";

/* `none` and `unbound` both lack a workspace, and the difference is the whole point: `none` is a
   Project that never wanted a folder (grouping, Base custody) and runs its turns in the Chat Home,
   while `unbound` is a workspace Project whose folder this computer does not know yet — it must ask
   for one instead of quietly running somewhere else. */
export type ProjectWorkspaceBinding =
  | { kind: "none" }
  | { kind: "unbound" }
  | { kind: "external"; capabilityId: string }
  | { kind: "app"; appId: string };

/* ── 外观：纯呈现，宽松口径 ────────────────────────────────────
 * color/icon 只是渲染端目录表的键，认不出就回落默认——刻意不做成联合类型。
 * 装饰字段一旦被 z.enum 锁死，将来改一次 icon id 就会让整本 projects.json
 * 解析失败并触发备份回滚：为一枚图标赔上整个账本，这个交换不成立。
 * ────────────────────────────────────────────────────────── */
export type ProjectAppearance = { color: string; icon: string };

type ProjectAppPlacement = Readonly<{
  appId: string;
  pinnedAt: number;
}>;

export type Project = {
  id: string;
  name: string;
  dir: string;
  appearance?: ProjectAppearance;
  gitRemote?: string;
  workspaceBinding: ProjectWorkspaceBinding;
  /** Canonical v8 records materialize both fields; absence denotes a pre-v6 wire input. */
  role?: "workspace" | "base-custody";
  nameSource?: "app" | "user";
  appPlacements: readonly ProjectAppPlacement[];
  grants: AppGrantRecord[];
  grantRevision: number;
  membershipRevision: number;
  projectLifecycleRevision: number;
  archivedAt?: number;
  sortIndex: number;
  createdAt: number;
  updatedAt: number;
  missing: boolean;
  /** Display-only origin; never authorizes local execution or App activation. */
  cloud?: { sourceDeviceId: string | null; remote: boolean };
};

export function appIdFromBinding(project: Pick<Project, "workspaceBinding">) {
  return project.workspaceBinding.kind === "app"
    ? project.workspaceBinding.appId
    : null;
}

/**
 * 「这条 binding 由 capability→真实路径映射支撑吗」只有一个答案来源。
 * external 是用户选择目录后由 main 签发的路径能力
 * 建。到处写 `kind === "external"` 就等于每加一种能力都要巡一遍全仓。
 */
export function workspaceCapabilityId(binding: ProjectWorkspaceBinding) {
  return binding.kind === "external" ? binding.capabilityId : null;
}

export type ProjectsSnapshot = {
  projects: Project[];
  sortMode: ProjectsSortMode;
  warning?: string;
};

type GitBranchKind = "local" | "remote";

export type GitBranchRef = {
  name: string;
  kind: GitBranchKind;
  current: boolean;
};

export type GitBranchSnapshot = {
  head: string;
  detached: boolean;
  uncommittedFiles: number;
  branches: GitBranchRef[];
};

export type GitBranchTarget = Pick<GitBranchRef, "name" | "kind">;

export type ProjectsEvent =
  | { type: "upserted"; project: Project }
  | { type: "removed"; projectId: string }
  | { type: "sort-mode"; sortMode: ProjectsSortMode }
  | { type: "warning"; message: string };

export type ProjectLocalDetachReason =
  | "project-base"
  | "group-memory"
  | "managed-worktree";

export type SetProjectAppPinnedInput = Readonly<{
  projectId: string;
  appId: string;
  pinned: boolean;
  expectedProjectLifecycleRevision: number;
}>;

export type SetProjectAppPinnedResult = Readonly<{
  project: Project;
  changed: boolean;
}>;

export type ProjectLocalDetachResult =
  | { status: "detached"; movedChatCount: number }
  | {
      status: "archive-required";
      reasons: ProjectLocalDetachReason[];
    };

export const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;
export const PROJECT_UNAVAILABLE = "PROJECT_UNAVAILABLE";

export const PROJECTS_CHANNEL = {
  list: "projects:list",
  ensureForApp: "projects:ensure-for-app",
  rename: "projects:rename",
  setAppearance: "projects:set-appearance",
  setAppPinned: "projects:app-placement:set-pinned",
  detachLocal: "projects:detach-local",
  chooseFolder: "projects:choose-folder",
  releaseMissing: "projects:release-missing",
  setSortMode: "projects:set-sort-mode",
  listBranches: "projects:branches:list",
  checkoutBranch: "projects:branches:checkout",
  createBranch: "projects:branches:create",
  reveal: "projects:reveal",
  event: "projects:event",
} as const;

export type ProjectsBridgeApi = {
  list: () => Promise<ProjectsSnapshot>;
  ensureForApp: (appId: string) => Promise<Project>;
  rename: (projectId: string, name: string) => Promise<Project>;
  setAppearance: (
    projectId: string,
    appearance: ProjectAppearance
  ) => Promise<Project>;
  setAppPinned: (
    input: SetProjectAppPinnedInput
  ) => Promise<SetProjectAppPinnedResult>;
  detachLocal: (projectId: string) => Promise<ProjectLocalDetachResult>;
  /** Resolves to null when the user dismisses the native directory picker. */
  chooseFolder: (projectId: string) => Promise<Project | null>;
  releaseMissing: (projectId: string) => Promise<number>;
  setSortMode: (sortMode: ProjectsSortMode) => Promise<ProjectsSortMode>;
  listBranches: (
    projectId: string,
    conversationId?: string
  ) => Promise<GitBranchSnapshot | null>;
  checkoutBranch: (
    projectId: string,
    target: GitBranchTarget
  ) => Promise<GitBranchSnapshot>;
  createBranch: (
    projectId: string,
    name: string
  ) => Promise<GitBranchSnapshot>;
  reveal: (projectId: string) => Promise<void>;
  onEvent: (callback: (event: ProjectsEvent) => void) => () => void;
};
