/**
 * [INPUT]: Depends on the built-in toolset factory, the tool registry, the agent plugin inventory and the composition hooks
 * [OUTPUT]: Provides composeBuiltinTools — one registry built from every product service, announced as the "builtin-tools" composition moment
 * [POS]: Composition-root helper for index.ts; the registry's members and their order are a single fact, not a sequence the entry file re-narrates
 */

import { createBuiltinToolsets } from "../../presets/builtin-toolsets";
import { AgentPluginInventory } from "../../extensions/agent-plugins/inventory";
import { BuiltinToolRegistry } from "../../tools/registry";
import { announceComposition } from "../boot/composition-hooks";
import type { EffectiveWorkspaceResolver } from "../../workspace/files/workspace-resolver";

type ToolsetInput = Parameters<typeof createBuiltinToolsets>[0];

export function composeBuiltinTools(input: {
  userData: string;
  services: Omit<ToolsetInput, "agentPlugins" | "resolveEffectiveWorkspace">;
  resolveEffectiveWorkspace: EffectiveWorkspaceResolver;
  incarnationOf(chatId: string): string | undefined;
}) {
  const registry = new BuiltinToolRegistry(
    ...createBuiltinToolsets({
      ...input.services,
      agentPlugins: new AgentPluginInventory(input.userData),
      resolveEffectiveWorkspace: input.resolveEffectiveWorkspace,
    })
  );
  announceComposition("builtin-tools", { registry, apps: input.services.appsService,
    resolveEffectiveWorkspace: input.resolveEffectiveWorkspace, incarnationOf: input.incarnationOf });
  return registry;
}
