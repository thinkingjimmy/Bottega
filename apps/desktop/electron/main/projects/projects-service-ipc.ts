/**
 * [INPUT]: Depends on renderer IPC, Electron shell reveal, strict Project command schemas, and the ProjectsService authority port
 * [OUTPUT]: Registers Project list/mutation/branch/reveal renderer commands for the main window; reveal accepts only Project ID
 * [POS]: Renderer command adapter for projects-service.ts; store serialization, lifecycle fences, and cleanup remain owned by ProjectsService
 */

import { shell, type BrowserWindow } from "electron";
import { z } from "zod";
import {
  PROJECT_ID_PATTERN,
  PROJECTS_CHANNEL,
  type GitBranchTarget,
  type SetProjectAppPinnedInput,
} from "../../../shared/projects-ipc";
import { rendererIpc } from "../ipc-registrar";
import { projectAppearanceSchema } from "./store/project-store";
import { projectSnapshotForRenderer } from "./service/renderer-policy";
import type { ProjectsService } from "./projects-service";

const appIdSchema = z.string().regex(/^[a-z0-9]{10}$/);
const projectIdSchema = z.string().regex(PROJECT_ID_PATTERN);
const branchTargetSchema = z.object({
  name: z.string().min(1).max(1024),
  kind: z.enum(["local", "remote"]),
}) satisfies z.ZodType<GitBranchTarget>;
const setProjectAppPinnedSchema = z
  .object({
    projectId: projectIdSchema,
    appId: appIdSchema,
    pinned: z.boolean(),
    expectedProjectLifecycleRevision: z.number().int().positive(),
  })
  .strict() satisfies z.ZodType<SetProjectAppPinnedInput>;

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
    .handle(PROJECTS_CHANNEL.setAppPinned, (rawInput) =>
      service.setAppPinned(setProjectAppPinnedSchema.parse(rawInput))
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
    .handle(PROJECTS_CHANNEL.reveal, (rawProjectId) =>
      service.runExclusive(async () => {
        const directory = service.resolveRevealDirectory(
          projectIdSchema.parse(rawProjectId)
        );
        shell.showItemInFolder(directory);
      })
    );
}
