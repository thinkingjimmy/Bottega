/**
 * [INPUT]: Current platform, Chat/Project authority, managed build/dependency callbacks and owner cancellation.
 * [OUTPUT]: createSourcePluginAuthoring provides source-scoped declaration, build, dependency and guarded version operations.
 * [POS]: Operation-only authoring implementation; ordinary plugin startup never loads this module.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { unifiedPluginManifestSchema } from "@bottega/contracts/plugins/platform";
import { pluginHash } from "../engineering/snapshot";
import { createPluginVersionActivator } from "./activation";
import type { UnifiedPluginAuthoringPort } from "./unified";
import type { UnifiedPluginPlatform } from "../platform/service";
import type { ProjectsService } from "../../projects/projects-service";
import type { ChatStore } from "../../chats/chat-store";

export function createSourcePluginAuthoring(ports: {
  platform: UnifiedPluginPlatform; projects: Pick<ProjectsService, "runExclusive">;
  chats: Pick<ChatStore, "getIncarnationId" | "getProjectId">; signal: AbortSignal;
  rebuild(id: string): Promise<unknown>; schedule(id: string): void;
  installDependencies(id: string, sourceRoot: string, signal: AbortSignal): Promise<unknown>;
}): UnifiedPluginAuthoringPort {
  const scoped = <T extends { signal: AbortSignal }>(input: T) => ({ ...input, signal: AbortSignal.any([ports.signal, input.signal]) });
  const sourceAuthority = (input: { pluginId: string; sourceRoot: string; chatId: string; incarnationId: string; signal: AbortSignal }, write = false) => {
    ports.signal.throwIfAborted(); input.signal.throwIfAborted();
    const item = ports.platform.get(input.pluginId);
    if (!item || item.directory.sourceDirectory !== input.sourceRoot || !item.sourceProject?.projectId ||
      ports.chats.getIncarnationId(input.chatId) !== input.incarnationId || ports.chats.getProjectId(input.chatId) !== item.sourceProject.projectId)
      throw new Error("PLUGIN_SOURCE_PROJECT_AUTHORITY_CHANGED");
    if (write && (!item.manifest.source.editable || !["authored", "copy"].includes(item.installation.origin))) throw new Error("PLUGIN_SOURCE_REQUIRES_PERSONAL_COPY");
    return item;
  };
  const manifestAt = async (root: string) => unifiedPluginManifestSchema.parse(JSON.parse(await readFile(join(root, "bottega.plugin.json"), "utf8")));
  return {
    install: async value => {
      const input = scoped(value), manifest = await manifestAt(input.sourceRoot);
      sourceAuthority({ ...input, pluginId: manifest.id }, true);
      await ports.platform.bindSource({ pluginId: manifest.id, sourceDirectory: input.sourceRoot, chatId: input.chatId });
      return ports.rebuild(manifest.id);
    },
    validate: async value => {
      const input = scoped(value), item = sourceAuthority(input), manifest = await manifestAt(input.sourceRoot);
      return { valid: true, pluginId: manifest.id, manifestDigest: pluginHash(manifest), status: item.status, error: item.error ?? null };
    },
    updateManifest: value => ports.projects.runExclusive(async () => {
      const input = scoped(value); sourceAuthority(input, true);
      const { writePluginDeclaration } = await import("./manifest");
      const result = await writePluginDeclaration({ ...input, current: () => { sourceAuthority(input, true); } });
      await ports.platform.sourceChanged(input.pluginId); ports.schedule(input.pluginId);
      return { pluginId: input.pluginId, manifestDigest: result.manifestDigest, status: ports.platform.get(input.pluginId)?.status ?? "building" };
    }),
    versions: async id => { ports.signal.throwIfAborted(); return ports.platform.revisions(id); },
    activate: createPluginVersionActivator({ signal: ports.signal, assertCurrent: input => { sourceAuthority(input, true); }, restore: (input, execution) => ports.platform.restore(input, execution) }),
    dependencies: async value => {
      const input = scoped(value); sourceAuthority(input, input.operation !== "check");
      return input.operation === "check" ? { package: JSON.parse(await readFile(join(input.sourceRoot, "package.json"), "utf8")), pnpm: "11.9.0" }
        : ports.installDependencies(input.pluginId, input.sourceRoot, input.signal);
    },
  };
}
