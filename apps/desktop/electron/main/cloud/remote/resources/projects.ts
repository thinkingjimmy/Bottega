/**
 * [INPUT]: Verified account/device scope, ProjectStore ownership and ProjectsService branch operations.
 * [OUTPUT]: projectResourcePort with binding-fenced reads, checkout/create and encrypted-budget search pages.
 * [POS]: Owner-computer Project resource adapter; paths and raw Git errors stay on the computer.
 */
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import { PROJECT_GIT_REFUSALS, projectGitPage, projectGitListSchema, projectGitCheckoutSchema, projectGitCreateSchema,
  type ProjectGitPage } from "@ai-chat/cloud-protocol/resources/project-git";
import type { ProjectsService } from "../../../projects/projects-service";

export type ProjectResourcePort = {
  execute(action: string, projectId: string, input: unknown, userId: string, current: () => void): Promise<ProjectGitPage | null>;
};
export function projectResourcePort(ports: { projects: Pick<ProjectsService, "store" | "isUsable" | "getProjectLifecycleRevision" | "listBranches" | "checkoutBranch" | "createBranch">;
  deviceId: string; environment: string }): ProjectResourcePort {
  const assert = (projectId: string, userId: string, current: () => void, expected?: string) => {
    current();
    const project = ports.projects.store.get(projectId), sync = project?.sync;
    if (!project || !sync || sync.deleted || sync.scope.environment !== ports.environment || sync.scope.userId !== userId ||
      sync.confirmed?.sourceDeviceId !== ports.deviceId || project.role !== "workspace" || project.archivedAt !== undefined ||
      project.workspaceBinding.kind !== "external" || !ports.projects.isUsable(projectId)) throw new Error("project-git-unavailable");
    const token = hashCanonical({ projectId, deviceId: ports.deviceId, binding: project.workspaceBinding, membershipRevision: project.membershipRevision,
      revision: ports.projects.getProjectLifecycleRevision(projectId) });
    if (expected && expected !== token) throw new Error("project-git-changed");
    return token;
  };
  return { execute: async (action, projectId, raw, userId, current) => {
    const workspaceToken = assert(projectId, userId, current);
    const check = () => { assert(projectId, userId, current, workspaceToken); };
    try {
      if (action === "project-git-list") {
        const input = projectGitListSchema.parse(raw), snapshot = await ports.projects.listBranches(projectId);
        check();
        return snapshot ? projectGitPage(snapshot, input, workspaceToken) : null;
      }
      const input = action === "project-git-checkout" ? projectGitCheckoutSchema.parse(raw) : projectGitCreateSchema.parse(raw);
      assert(projectId, userId, current, input.workspaceToken);
      // A successful Git effect must fit its receipt even when a branch name cannot fit twice in a list page.
      const headPage = (head: string, detached = false, uncommittedFiles = 0) => projectGitPage({ head, detached, uncommittedFiles, branches: [] }, { query: "", cursor: null }, workspaceToken);
      headPage("target" in input ? input.target.name : input.name);
      const snapshot = "target" in input ? await ports.projects.checkoutBranch(projectId, input.target, check)
        : await ports.projects.createBranch(projectId, input.name, check);
      check();
      return headPage(snapshot.head, snapshot.detached, snapshot.uncommittedFiles);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : error instanceof Error ? error.message : "";
      if (code === "command-expired" || (PROJECT_GIT_REFUSALS as readonly string[]).includes(code)) throw new Error(code);
      throw new Error(action === "project-git-list" ? "project-git-unavailable" : action === "project-git-checkout" ? "project-git-checkout-failed" : "project-git-create-failed");
    }
  } };
}
