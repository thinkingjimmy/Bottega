/**
 * [INPUT]: Depends on renderer IPC, Electron directory chooser, strict Project command schemas, and the ProjectsService authority port
 * [OUTPUT]: Registers Project list/mutation/branch/workspace-rebind renderer commands for the main window
 * [POS]: Renderer command adapter for projects-service.ts; store serialization, lifecycle fences, and cleanup remain owned by ProjectsService
 */

import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { dialog, type BrowserWindow } from "electron";
import { z } from "zod";
import {
  PROJECT_ID_PATTERN,
  PROJECT_UNAVAILABLE,
  PROJECTS_CHANNEL,
  type GitBranchTarget,
  type ProjectMemoryRebindMode,
} from "../../../shared/projects-ipc";
import { translate } from "../../../shared/i18n/runtime";
import { rendererIpc } from "../ipc-registrar";
import {
  assertWorkspaceDisjoint,
  isUsableDirectory,
} from "./fs-utils";
import { projectAppearanceSchema } from "./project-store";
import { projectSnapshotForRenderer } from "./service/renderer-policy";
import { statusError } from "./service/errors";
import type { ProjectsService } from "./projects-service";

const appIdSchema = z.string().regex(/^[a-z0-9]{10}$/);
const projectIdSchema = z.string().regex(PROJECT_ID_PATTERN);
const branchTargetSchema = z.object({
  name: z.string().min(1).max(1024),
  kind: z.enum(["local", "remote"]),
}) satisfies z.ZodType<GitBranchTarget>;

export function registerProjectsServiceIpc(
  window: BrowserWindow,
  rendererUrl: string,
  service: ProjectsService
) {
  rendererIpc(window, rendererUrl, "拒绝非主窗口的 Projects 请求")
    .roles("main", "app-window")
    .handleWithContext(PROJECTS_CHANNEL.list, async (context) =>
      projectSnapshotForRenderer(context, await service.list())
    )
    .roles("main")
    .handle(PROJECTS_CHANNEL.ensureForApp, (rawAppId) =>
      service.ensureForApp(appIdSchema.parse(rawAppId))
    )
    .handle(PROJECTS_CHANNEL.rename, (rawProjectId, rawName) =>
      service.runExclusive(async () => {
        const projectId = projectIdSchema.parse(rawProjectId);
        service.assertProjectOpen(projectId);
        const project = await service.store.rename(
          projectId,
          z.string().trim().min(1).max(100).parse(rawName)
        );
        const wire = service.withMissing(project);
        service.emit({ type: "upserted", project: wire });
        return wire;
      })
    )
    .handle(PROJECTS_CHANNEL.setAppearance, (rawProjectId, rawAppearance) =>
      service.runExclusive(async () => {
        const projectId = projectIdSchema.parse(rawProjectId);
        service.assertProjectOpen(projectId);
        const project = await service.store.setAppearance(
          projectId,
          projectAppearanceSchema.parse(rawAppearance)
        );
        const wire = service.withMissing(project);
        service.emit({ type: "upserted", project: wire });
        return wire;
      })
    )
    .handle(PROJECTS_CHANNEL.detachLocal, (rawProjectId) =>
      service.detachLocalProject(projectIdSchema.parse(rawProjectId))
    )
    .handle(PROJECTS_CHANNEL.releaseMissing, (rawProjectId) =>
      service.releaseMissing(projectIdSchema.parse(rawProjectId))
    )
    .handle(PROJECTS_CHANNEL.setSortMode, (rawMode) =>
      service.runExclusive(async () => {
        const sortMode = await service.store.setSortMode(
          z.enum(["last-updated", "manual"]).parse(rawMode)
        );
        service.emit({ type: "sort-mode", sortMode });
        return sortMode;
      })
    )
    .handle(PROJECTS_CHANNEL.listBranches, (rawProjectId) =>
      service.listBranches(projectIdSchema.parse(rawProjectId))
    )
    .handle(PROJECTS_CHANNEL.checkoutBranch, (rawProjectId, rawTarget) =>
      service.checkoutBranch(
        projectIdSchema.parse(rawProjectId),
        branchTargetSchema.parse(rawTarget)
      )
    )
    .handle(PROJECTS_CHANNEL.createBranch, (rawProjectId, rawName) =>
      service.createBranch(
        projectIdSchema.parse(rawProjectId),
        z.string().max(1024).parse(rawName)
      )
    )
    .handle(PROJECTS_CHANNEL.chooseWorkspaceBinding, (rawProjectId, rawMode) =>
      chooseWorkspaceBinding(
        window,
        service,
        projectIdSchema.parse(rawProjectId),
        z.enum(["retain", "new"]).parse(rawMode)
      )
    );
}

async function chooseWorkspaceBinding(
  window: BrowserWindow,
  service: ProjectsService,
  projectId: string,
  mode: ProjectMemoryRebindMode
) {
  const current = service.store.get(projectId);
  if (current?.workspaceBinding.kind === "app") {
    throw statusError(403, "App Project 只能经删除 App 解除绑定");
  }
  const result = await dialog.showOpenDialog(window, {
    title: translate(
      service.options.locale?.() ?? "en",
      "settings.native.chooseProjectWorkspace"
    ),
    properties: ["openDirectory"],
  });
  const selected = result.filePaths[0];
  if (result.canceled || !selected) return null;
  const expectation = (await service.options.snapshotMemoryRebind?.(projectId)) ?? {
    expectedOldMemorySpaceId: null,
    expectedSpaceGenerationRevision: null,
  };
  const capsule = await service.runExclusive(async () => {
    service.assertProjectOpen(projectId);
    service.assertWorkspaceRebindAllowed(projectId);
    const canonical = await realpath(selected);
    if (!isUsableDirectory(canonical)) throw new Error("所选文件夹不可用");
    assertWorkspaceDisjoint(canonical, service.managedDirs());
    const capabilityId = `workspace-${randomUUID().replaceAll("-", "")}`;
    const operationId = `project-rebind:${randomUUID()}`;
    const owner = service.store.get(projectId);
    if (!owner) throw new Error(`${PROJECT_UNAVAILABLE}: Project 不存在`);
    const journal = service.options.rebindJournal;
    if (journal) {
      return journal.begin({
        operationId,
        projectId,
        sourceBinding: owner.workspaceBinding,
        sourceDir: owner.dir,
        sourceMembershipRevision: owner.membershipRevision,
        ...expectation,
        targetBinding: { kind: "external", capabilityId },
        targetDir: canonical,
        mode,
      });
    }
    const now = Date.now();
    return {
      operationId,
      projectId,
      sourceBinding: owner.workspaceBinding,
      sourceDir: owner.dir,
      sourceMembershipRevision: owner.membershipRevision,
      ...expectation,
      targetBinding: { kind: "external" as const, capabilityId },
      targetDir: canonical,
      mode,
      phase: "prepared" as const,
      createdAt: now,
      updatedAt: now,
    };
  });
  return service.trackRebind(service.driveMemoryRebind(capsule));
}
