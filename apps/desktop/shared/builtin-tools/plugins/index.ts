/**
 * [INPUT]: Zod and the shared built-in tool platform.
 * [OUTPUT]: Scoped plugin installation, validation, history and activation tool specifications.
 * [POS]: Agent-facing authoring contract; targets come from the current Chat lease.
 */
import { z } from "zod";
import { mutation, read, type BuiltinToolSpec } from "../platform";

const generation = z.string().min(1).max(200);
export const PLUGIN_TOOL_SPECS = [
  {
    name: "install_plugin", domainId: "plugins", access: "mutate", manualTurnOnly: true, planExcluded: true,
    description: "Install and watch a UI plugin from a relative folder inside this Chat's workspace. The host validates plugin.json, freezes source and builds in its OS sandbox. Returns the active generation or a precise build failure; existing working versions remain available.",
    inputSchema: z.object({ directory: z.string().min(1).max(512).default(".") }).strict(), annotations: mutation,
  },
  {
    name: "validate_plugin", domainId: "plugins", access: "read", manualTurnOnly: true,
    description: "Validate the UI plugin owned by this Chat and report bounded diagnostics. Does not activate a generation or read another Chat's plugin.",
    inputSchema: z.object({}).strict(), annotations: read,
  },
  {
    name: "plugin_versions", domainId: "plugins", access: "read", manualTurnOnly: true,
    description: "Read the active and retained generations of this Chat's plugin, including build failures. Use the returned current generation for an activation compare-and-swap.",
    inputSchema: z.object({}).strict(), annotations: read,
  },
  {
    name: "activate_plugin_version", domainId: "plugins", access: "mutate", manualTurnOnly: true, planExcluded: true,
    description: "Activate a retained generation of this Chat's plugin only if the active generation still matches. The host rechecks source integrity, settings and grants. Revoked permissions never return through rollback.",
    inputSchema: z.object({ generationId: generation, expectedActiveGenerationId: generation }).strict(), annotations: mutation,
  },
] as const satisfies readonly BuiltinToolSpec[];
