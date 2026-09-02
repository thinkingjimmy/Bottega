/**
 * [INPUT]: Depends on shared Project placement/grant contracts, the strict v8 schema, and injected ProjectStore queue/state/commit ports
 * [OUTPUT]: Provides positive-grant-gated Pin/Unpin, exact affected-Project planning, single-commit held App cleanup, and orphan reconciliation over the canonical ProjectFile
 * [POS]: ProjectStore placement collaborator; owns placement atoms without owning a second ledger or re-entering ProjectsService
 */

import { PROJECT_ID_PATTERN } from "../../../../shared/projects-ipc";
import { isPositiveAppGrant } from "../../../../shared/apps-ipc";
import {
  storedProjectSchema,
  type ProjectFile,
  type StoredProject,
} from "./project-store-schema";

type ProjectAppPlacementPorts = {
  enqueue<T>(operation: () => Promise<T>): Promise<T>;
  state(): ProjectFile;
  require(projectId: string): StoredProject;
  commit(next: ProjectFile): Promise<void>;
  now(): number;
};

export type ProjectPlacementMutation = Readonly<{
  project: StoredProject;
  changed: boolean;
}>;

export type ProjectPlacementCleanup = Readonly<{
  changed: boolean;
  affectedProjectIds: readonly string[];
}>;

const APP_ID_PATTERN = /^[a-z0-9]{10}$/;
const clone = <T>(value: T): T => structuredClone(value);

export class ProjectAppPlacements {
  constructor(private readonly ports: ProjectAppPlacementPorts) {}

  has(projectId: string, appId: string) {
    assertProjectId(projectId);
    assertAppId(appId);
    return this.ports.require(projectId).appPlacements.some(
      (placement) => placement.appId === appId
    );
  }

  setPinned(
    projectId: string,
    appId: string,
    pinned: boolean,
    expectedProjectLifecycleRevision: number
  ) {
    return this.ports.enqueue(async (): Promise<ProjectPlacementMutation> => {
      assertProjectId(projectId);
      assertAppId(appId);
      const current = this.ports.require(projectId);
      if (current.projectLifecycleRevision !== expectedProjectLifecycleRevision) {
        throw Object.assign(new Error("Project lifecycle 已变更"), { status: 409 });
      }
      assertPlacementOwner(current);
      const existing = current.appPlacements.find(
        (placement) => placement.appId === appId
      );
      if (
        pinned &&
        !current.grants.some(
          (grant) => grant.appId === appId && isPositiveAppGrant(grant)
        )
      ) {
        throw Object.assign(
          new Error("App 尚未在此 Project 获得授权，不能 Pin 到 Sidebar"),
          { status: 409 }
        );
      }
      if (Boolean(existing) === pinned) {
        return { project: clone(current), changed: false };
      }
      const appPlacements = pinned
        ? [...current.appPlacements, { appId, pinnedAt: this.ports.now() }]
        : current.appPlacements.filter((placement) => placement.appId !== appId);
      const project = storedProjectSchema.parse({
        ...current,
        appPlacements: [...appPlacements].sort(
          (left, right) =>
            left.pinnedAt - right.pinnedAt || left.appId.localeCompare(right.appId)
        ),
      });
      await this.replaceMany([project]);
      return { project: clone(project), changed: true };
    });
  }

  clearAppPlacementsHeld(appId: string) {
    assertAppId(appId);
    return this.ports.enqueue(() =>
      this.rewrite((placementAppId) => placementAppId !== appId)
    );
  }

  projectIdsForApp(appId: string) {
    assertAppId(appId);
    return this.ports.state().projects
      .filter((project) =>
        project.appPlacements.some((placement) => placement.appId === appId)
      )
      .map((project) => project.id);
  }

  reconcileOrphanAppPlacementsHeld(liveAppIds: ReadonlySet<string>) {
    for (const appId of liveAppIds) assertAppId(appId);
    return this.ports.enqueue(() =>
      this.rewrite((placementAppId) => liveAppIds.has(placementAppId))
    );
  }

  private async rewrite(
    retain: (appId: string) => boolean
  ): Promise<ProjectPlacementCleanup> {
    const affected: StoredProject[] = [];
    for (const current of this.ports.state().projects) {
      const appPlacements = current.appPlacements.filter((placement) =>
        retain(placement.appId)
      );
      if (appPlacements.length === current.appPlacements.length) continue;
      affected.push(storedProjectSchema.parse({ ...current, appPlacements }));
    }
    if (!affected.length) {
      return { changed: false, affectedProjectIds: [] };
    }
    await this.replaceMany(affected);
    return {
      changed: true,
      affectedProjectIds: affected.map((project) => project.id),
    };
  }

  private replaceMany(projects: readonly StoredProject[]) {
    const replacements = new Map(projects.map((project) => [project.id, project]));
    const state = this.ports.state();
    return this.ports.commit({
      ...state,
      projects: state.projects.map(
        (project) => replacements.get(project.id) ?? project
      ),
    });
  }
}

function assertPlacementOwner(project: StoredProject) {
  if (
    project.role !== "workspace" ||
    project.workspaceBinding.kind === "app" ||
    project.deletionCheckpoint
  ) {
    throw Object.assign(
      new Error("只有未删除的普通 Project 可以管理 App Sidebar placement"),
      { status: 409 }
    );
  }
}

function assertProjectId(projectId: string) {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error("Project id 格式无效");
}

function assertAppId(appId: string) {
  if (!APP_ID_PATTERN.test(appId)) throw new Error("App id 格式无效");
}
