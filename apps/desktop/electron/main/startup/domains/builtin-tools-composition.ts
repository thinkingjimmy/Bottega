/**
 * [INPUT]: Domain tool factory/registry, Agent plugin inventory, main document/workspace owners and composition hooks.
 * [OUTPUT]: Document/workspace initialization followed by one exact product tool registry and its composition event.
 * [POS]: Composition-root helper for index.ts; the registry's members and their order are a single fact, not a sequence the entry file re-narrates
 */

import { createBuiltinToolsets } from "../../presets/builtin-toolsets";
import { AgentPluginInventory } from "../../extensions/agent-plugins/inventory";
import { BuiltinToolRegistry } from "../../tools/registry";
import { announceComposition } from "../boot/composition-hooks";
import type { EffectiveWorkspaceResolver } from "../../workspace/files/workspace-resolver";
import { initializeDesignDocuments } from "../../design/documents/runtime";
import { initializeArtifactWorkspace } from "../../artifacts/workspace/runtime";
import { join } from "node:path";

type ToolsetInput = Parameters<typeof createBuiltinToolsets>[0];

export async function composeBuiltinTools(input: {
  userData: string;
  services: Omit<ToolsetInput, "agentPlugins" | "resolveEffectiveWorkspace">;
  resolveEffectiveWorkspace: EffectiveWorkspaceResolver;
  incarnationOf(chatId: string): string | undefined;
}) {
  await initializeDesignDocuments(input.userData, input.services.chatStore, input.services.chatsService, input.resolveEffectiveWorkspace);
  await initializeArtifactWorkspace(join(input.userData, "artifact-design"));
  const registry = new BuiltinToolRegistry(
    ...createBuiltinToolsets({
      ...input.services,
      agentPlugins: new AgentPluginInventory(input.userData),
      resolveEffectiveWorkspace: input.resolveEffectiveWorkspace,
    })
  );
  announceComposition("builtin-tools", { registry, apps: input.services.appsService,
    chats: input.services.chatsService,
    resolveEffectiveWorkspace: input.resolveEffectiveWorkspace, incarnationOf: input.incarnationOf });
  return registry;
}
