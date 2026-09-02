/**
 * [INPUT]: Depends on canonical BaseNavigation facts and Project workspace/custody facts
 * [OUTPUT]: Provides canonical Project-to-Base navigation plus root and Project-contained visibility predicates
 * [POS]: Base navigation truth table; creation, migration, and projection share one rule so internal App and custody ownership cannot leak
 */

import type { BaseNavigation } from "./facts";
import type { Project } from "../projects-ipc";

type ProjectBaseFacts = Pick<Project, "id"> &
  Partial<Pick<Project, "workspaceBinding" | "role">>;

export function baseNavigationForProject(
  project: ProjectBaseFacts,
  current?: BaseNavigation
): BaseNavigation {
  if (project.role === "base-custody") {
    return current?.kind === "root-user-managed" &&
      current.source === "retained-app-data"
      ? current
      : {
          kind: "root-user-managed",
          source: "retained-app-data",
          activatedAt: 0,
        };
  }
  return project.workspaceBinding?.kind === "app"
    ? { kind: "internal-app", appId: project.workspaceBinding.appId }
    : { kind: "project-contained", projectId: project.id };
}

export const appearsInRootBases = (navigation: BaseNavigation) =>
  navigation.kind === "root-user-managed";

export const appearsInProjectBase = (navigation: BaseNavigation, projectId: string) =>
  navigation.kind === "project-contained" && navigation.projectId === projectId;
