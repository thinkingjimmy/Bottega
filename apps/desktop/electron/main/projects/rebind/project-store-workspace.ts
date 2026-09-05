/**
 * [INPUT]: Depends on shared Project/App capability contracts, project schemas/policy, and injected ProjectStore queue/state/commit ports
 * [OUTPUT]: Provides ProjectStoreWorkspace for custody conversion, workspace rebinding, archival, and App grant mutations
 * [POS]: The ProjectStore workspace/capability subdomain; ProjectStore retains persistence authority and delegates serialized mutations here
 */

import {
  isPositiveAppGrant,
  type AppGrantRecord,
} from "../../../../shared/apps-ipc";
import {
  workspaceCapabilityId,
  type ProjectWorkspaceBinding,
} from "../../../../shared/projects-ipc";
import {
  storedProjectSchema,
  type ProjectFile,
  type StoredProject,
} from "../store/project-store-schema";
import { planWorkspaceRebind } from "./project-workspace-policy";

type ProjectWorkspacePorts = {
  enqueue<T>(operation: () => Promise<T>): Promise<T>;
  state(): ProjectFile;
  require(projectId: string): StoredProject;
  commit(next: ProjectFile): Promise<void>;
  now(): number;
};

export class ProjectStoreWorkspace {
  constructor(private readonly ports: ProjectWorkspacePorts) {}

  convertToBaseCustody(projectId: string) {
    return this.ports.enqueue(async () => {
      const current = this.ports.require(projectId);
      if (current.role === "base-custody") return structuredClone(current);
      const project = storedProjectSchema.parse({
        ...current,
        dir: "",
        workspaceBinding: { kind: "none" },
        role: "base-custody",
        nameSource: "user",
        appPlacements: [],
        grants: [],
        grantRevision: current.grantRevision + 1,
        resourceAdmissions: [],
        membershipRevision: current.membershipRevision + 1,
        updatedAt: this.ports.now(),
      });
      await this.replace(project);
      return structuredClone(project);
    });
  }

  resolve(binding: ProjectWorkspaceBinding) {
    const capabilityId = workspaceCapabilityId(binding);
    return capabilityId
      ? this.ports.state().workspaceCapabilities[capabilityId]
      : undefined;
  }

  setBinding(
    projectId: string,
    binding: ProjectWorkspaceBinding,
    externalDir?: string
  ) {
    return this.ports.enqueue(async () => {
      const state = this.ports.state();
      const { project, workspaceCapabilities } = planWorkspaceRebind({
        project: this.ports.require(projectId),
        binding,
        externalDir,
        workspaceCapabilities: state.workspaceCapabilities,
        now: this.ports.now(),
      });
      await this.ports.commit({
        ...state,
        workspaceCapabilities,
        projects: state.projects.map((item) =>
          item.id === projectId ? project : item
        ),
      });
      return structuredClone(project);
    });
  }

  setArchivedAt(projectId: string, archivedAt: number | undefined) {
    return this.ports.enqueue(async () => {
      const current = this.ports.require(projectId);
      const project = storedProjectSchema.parse({
        ...current,
        archivedAt,
        updatedAt: this.ports.now(),
      });
      await this.replace(project);
      return structuredClone(project);
    });
  }

  setAppGrant(projectId: string, grant: AppGrantRecord) {
    return this.ports.enqueue(async () => {
      const current = this.ports.require(projectId);
      if (current.workspaceBinding.kind === "app") {
        throw Object.assign(new Error("App Project 不能再附加 App"), {
          status: 403,
        });
      }
      const project = storedProjectSchema.parse({
        ...current,
        grants: [
          ...current.grants.filter((item) => item.appId !== grant.appId),
          structuredClone(grant),
        ],
        appPlacements: isPositiveAppGrant(grant)
          ? current.appPlacements
          : current.appPlacements.filter((item) => item.appId !== grant.appId),
        grantRevision: current.grantRevision + 1,
        updatedAt: this.ports.now(),
      });
      await this.replace(project);
      return structuredClone(project);
    });
  }

  revokeAppGrant(projectId: string, appId: string) {
    return this.ports.enqueue(async () => {
      const current = this.ports.require(projectId);
      const grants = current.grants.filter((item) => item.appId !== appId);
      if (grants.length === current.grants.length) return structuredClone(current);
      const project = storedProjectSchema.parse({
        ...current,
        grants,
        appPlacements: current.appPlacements.filter(
          (placement) => placement.appId !== appId
        ),
        grantRevision: current.grantRevision + 1,
        updatedAt: this.ports.now(),
      });
      await this.replace(project);
      return structuredClone(project);
    });
  }

  private replace(project: StoredProject) {
    const state = this.ports.state();
    return this.ports.commit({
      ...state,
      projects: state.projects.map((item) =>
        item.id === project.id ? project : item
      ),
    });
  }
}
