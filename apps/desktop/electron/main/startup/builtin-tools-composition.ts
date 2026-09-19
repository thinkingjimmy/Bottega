/**
 * [INPUT]: Depends on the built-in toolset factory, the tool registry, the agent plugin inventory and the three e2e drivers exported by main-window-runtime
 * [OUTPUT]: Provides composeBuiltinTools — one registry built from every product service, with the e2e drivers installed in the order they must be installed
 * [POS]: Composition-root helper for index.ts; the registry's members and their order are a single fact, not a sequence the entry file re-narrates
 */

import { createBuiltinToolsets } from "../builtin-toolsets";
import { AgentPluginInventory } from "../extensions/agent-plugin-inventory";
import { BuiltinToolRegistry } from "../tools/registry";
import {
  installAppGuiE2eDriver,
  installBrowserE2eDriver,
  installDesignE2eDriver,
} from "./main-window-runtime";

type ToolsetInput = Parameters<typeof createBuiltinToolsets>[0];

export function composeBuiltinTools(input: {
  userData: string;
  services: Omit<ToolsetInput, "agentPlugins">;
  resolveEffectiveWorkspace: Parameters<typeof installDesignE2eDriver>[1];
  incarnationOf(chatId: string): string | undefined;
}) {
  const registry = new BuiltinToolRegistry(
    ...createBuiltinToolsets({
      ...input.services,
      agentPlugins: new AgentPluginInventory(input.userData),
    })
  );
  installBrowserE2eDriver(registry, input.incarnationOf);
  installAppGuiE2eDriver(input.services.appsService);
  installDesignE2eDriver(
    input.services.appsService,
    input.resolveEffectiveWorkspace,
    registry,
    input.incarnationOf
  );
  return registry;
}
