/**
 * [INPUT]: Depends on Sidebar active path/origin, main App residence, visible Projects, App records, and global pin facts
 * [OUTPUT]: Provides the exclusive SidebarAppTarget resolver with pending/main/independent residence distinction, context, and consumer hook
 * [POS]: First-stage active authority; ProjectItem alone resolves an exact Project target against local expanded state
 */

import { createContext, useContext } from "react";
import type { AppRecord } from "../../../../shared/apps-ipc";
import type { Project } from "../../../../shared/projects-ipc";
import type { SurfaceResidence } from "../../../../shared/window-surfaces-ipc";
import type { SidebarAppOrigin } from "./app-origin";

export type SidebarAppTarget =
  | Readonly<{ kind: "project-app"; appId: string; projectId: string }>
  | Readonly<{ kind: "global-app"; appId: string }>
  | Readonly<{ kind: "apps"; appId: string }>
  | Readonly<{ kind: "pending"; appId: string; projectId: string | null }>
  | Readonly<{ kind: "none" }>;

export function originMatchesTarget(
  origin: SidebarAppOrigin,
  target: SidebarAppTarget
) {
  return !origin || (
    (target.kind === "project-app" || target.kind === "pending") &&
    target.appId === origin.appId &&
    target.projectId === origin.projectId
  );
}

type ResolveSidebarAppTargetInput = Readonly<{
  activePath: string;
  origin: SidebarAppOrigin;
  residence: SurfaceResidence | undefined;
  hasResidenceBridge: boolean;
  projects: readonly Project[];
  records: readonly AppRecord[];
  globalPinnedAppIds: ReadonlySet<string>;
}>;

export function activeAppId(activePath: string) {
  if (!activePath || activePath.includes("#app-use:")) return null;
  const match = /^\/apps\/([^/]+)(?:\/(?:app|data))?$/.exec(activePath);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

export function resolveSidebarAppTarget({
  activePath,
  origin,
  residence,
  hasResidenceBridge,
  projects,
  records,
  globalPinnedAppIds,
}: ResolveSidebarAppTargetInput): SidebarAppTarget {
  const appId = activeAppId(activePath);
  if (!appId) return { kind: "none" };
  const recordExists = records.some((record) => record.id === appId);
  const project = origin?.appId === appId && recordExists
    ? projects.find(
      (candidate) =>
        candidate.id === origin.projectId &&
        candidate.role !== "base-custody" &&
        candidate.workspaceBinding.kind !== "app" &&
        !candidate.archivedAt &&
        !candidate.missing &&
        candidate.appPlacements.some((placement) => placement.appId === appId)
    )
    : undefined;
  if (hasResidenceBridge && !residence) {
    return { kind: "pending", appId, projectId: project?.id ?? null };
  }
  if (hasResidenceBridge && residence!.windowId !== null) {
    return { kind: "none" };
  }
  if (project) {
    return { kind: "project-app", appId, projectId: project.id };
  }
  return globalPinnedAppIds.has(appId)
    ? { kind: "global-app", appId }
    : { kind: "apps", appId };
}

export const SidebarAppTargetContext = createContext<SidebarAppTarget>({
  kind: "none",
});

export const useSidebarAppTarget = () => useContext(SidebarAppTargetContext);
