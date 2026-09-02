/**
 * [INPUT]: Depends on AppsService GUI/data-migration ports, ProjectsService App custody lookup, and BasesService main-owned mutations
 * [OUTPUT]: Provides App GUI Base snapshot/query/mutation adapters, App data migration wiring, and startup migration reconciliation reporting
 * [POS]: Startup composition seam between Apps and Bases; the Electron root supplies owners but does not implement cross-domain policy
 */

import type { AppsService } from "../apps/apps-service";
import type { BasesService } from "../bases/bases-service";
import type { ProjectStore } from "../projects/store/project-store";

const missingBase = () =>
  Object.assign(new Error("该 App 没有可用的 Base"), {
    status: 404,
    code: "base_not_found",
    outcome: "not-committed" as const,
  });

export async function configureAppBaseRuntime(input: Readonly<{
  apps: AppsService;
  projects: ProjectStore;
  bases: BasesService;
}>) {
  const ownerKey = (appId: string) => {
    const project = input.projects.findByAppId(appId);
    if (!project) throw missingBase();
    return `project:${project.id}`;
  };

  input.apps.configureGuiApi({
    snapshot: async (appId) => {
      const project = input.projects.findByAppId(appId);
      return project ? input.bases.get(`project:${project.id}`) : null;
    },
    querySnapshot: async (appId) => {
      const project = input.projects.findByAppId(appId);
      return project
        ? input.bases.querySnapshot(`project:${project.id}`)
        : null;
    },
    insertRows: (request) =>
      input.bases.insertRowsFromAppGui({
        ownerKey: ownerKey(request.binding.appId),
        ...request,
      }),
    patchRows: (request) =>
      input.bases.patchRowsFromAppGui({
        ownerKey: ownerKey(request.binding.appId),
        ...request,
      }),
    deleteRows: (request) =>
      input.bases.deleteRowsFromAppGui({
        ownerKey: ownerKey(request.binding.appId),
        ...request,
      }),
    readAttachment: (request) =>
      input.bases.readAttachmentForAppGui(
        ownerKey(request.binding.appId),
        request.attachmentId
      ),
  });
  input.apps.configureAppDataMigrations({
    apply: async (appId, file) => {
      const project = input.projects.findByAppId(appId);
      if (!project) throw new Error("App 对应的 Project 不存在");
      await input.bases.applyAppDataMigration(`project:${project.id}`, file);
    },
  });
  for (const failure of await input.apps.reconcileAppDataMigrations()) {
    console.warn(
      `[apps] live Base migration failed for ${failure.appId}: ${failure.message}`
    );
  }
}
