/**
 * [INPUT]: Depends on shared Project/App grant contracts and the stored Project schema
 * [OUTPUT]: Provides pure Project workspace-rebind planning with App-grant exclusion and capability-map rotation
 * [POS]: Project workspace policy kernel; ProjectStore serializes and persists the state transition it computes
 */

import { workspaceCapabilityId, type ProjectWorkspaceBinding } from "../../../shared/projects-ipc";
import { isPositiveAppGrant } from "../../../shared/apps-ipc";
import { storedProjectSchema, type ProjectFile, type StoredProject } from "./project-store-schema";

export function planWorkspaceRebind(input: {
  project: StoredProject;
  binding: ProjectWorkspaceBinding;
  externalDir?: string;
  workspaceCapabilities: ProjectFile["workspaceCapabilities"];
  now: number;
}) {
  if (input.binding.kind === "app") assertNoPositiveAppGrants(input.project);
  const workspaceCapabilities = { ...input.workspaceCapabilities };
  const previousCapability = workspaceCapabilityId(input.project.workspaceBinding);
  if (previousCapability) delete workspaceCapabilities[previousCapability];
  const nextCapability = workspaceCapabilityId(input.binding);
  if (nextCapability) {
    if (!input.externalDir) throw new Error(`${input.binding.kind} binding 缺少受信目录`);
    workspaceCapabilities[nextCapability] = input.externalDir;
  }
  const project = storedProjectSchema.parse({
    ...input.project,
    workspaceBinding: input.binding,
    membershipRevision: input.project.membershipRevision + 1,
    dir: nextCapability
      ? input.externalDir
      : input.binding.kind === "app"
        ? input.project.dir
        : "",
    updatedAt: input.now,
  });
  return { project, workspaceCapabilities };
}

export function assertNoPositiveAppGrants(project: StoredProject) {
  const positive = project.grants.filter(isPositiveAppGrant);
  if (!positive.length) return;
  throw Object.assign(
    new Error(`Project 仍持有 App 授权，请先撤销：${positive.map((grant) => grant.appId).join("、")}`),
    { status: 409 }
  );
}
