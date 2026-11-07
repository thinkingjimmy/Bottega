/**
 * [INPUT]: Catalog, Project/archive services, source/copy provenance and installed Dock owner.
 * [OUTPUT]: pluginSourceBinding preserves source/package roles; pluginSourceProjectPorts binds on-demand source operations.
 * [POS]: On-demand source-owner adapter; source preparation loads this module with its engineering owner.
 */
import type { UnifiedPluginCatalogItem, UnifiedPluginManifest } from "@bottega/contracts/plugins/platform";
import type { ProjectsService } from "../../projects/projects-service";
import type { ArchiveService } from "../../archive/archive-service";
import type { PluginSourceProjects } from "../engineering/source-projects";
import type { UnifiedPluginPlatform } from "../platform/service";

type SourcePorts = { userData: string; libraryRoot(): string | null; projects: ProjectsService; archive: Pick<ArchiveService, "restore"> };

export function pluginSourceProjectPorts(ports: SourcePorts, platform: UnifiedPluginPlatform): ConstructorParameters<typeof PluginSourceProjects>[0] {
  return {
    userData: ports.userData, libraryRoot: ports.libraryRoot, projectDirectories: () => ports.projects.managedDirs(),
    lookup: id => { const item = platform.get(id); return item ? pluginSourceBinding(item) : null; },
    commitProject: async (path, name) => {
      const { project } = await ports.projects.commitExternalProject({ canonicalRoot: path, name });
      if (project.archivedAt) await ports.archive.restore([{ kind: "project", id: project.id }]);
      return { id: project.id, membershipRevision: ports.projects.getMembershipRevision(project.id) ?? 0 };
    },
    register: async input => {
      const previous = platform.get(input.manifest.id);
      await platform.register({ manifest: input.manifest, packageDirectory: previous?.directory.packageDirectory ?? input.sourceDirectory,
        sourceDirectory: input.sourceDirectory, projectId: input.projectId, replace: true });
      await platform.bindSource({ pluginId: input.manifest.id, sourceDirectory: input.sourceDirectory, projectId: input.projectId });
      await queueCopiedWidgetTarget(input);
    },
  };
}

export function pluginSourceBinding(item: UnifiedPluginCatalogItem) {
  return { sourceDirectory: item.directory.sourceDirectory, packageDirectory: item.directory.packageDirectory,
    projectId: item.sourceProject?.projectId,
    editable: !["external", "official"].includes(item.installation.origin) && item.manifest.source.editable };
}

async function queueCopiedWidgetTarget(input: { manifest: UnifiedPluginManifest; instanceId?: string }) {
  if (!input.instanceId) return;
  if (input.manifest.source.kind !== "copy" || !input.manifest.source.pluginId) throw new Error("PLUGIN_WIDGET_COPY_SOURCE_REQUIRED");
  const { pluginDockWidgets } = await import("../../system-dock/widgets/plugins/runtime"), owner = pluginDockWidgets();
  if (!owner) throw new Error("PLUGIN_WIDGET_OWNER_UNAVAILABLE");
  await owner.queueCopyTarget({ sourcePluginId: input.manifest.source.pluginId, pluginId: input.manifest.id, instanceId: input.instanceId });
}
