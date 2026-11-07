/**
 * [INPUT]: Zod and the shared plugin tool platform.
 * [OUTPUT]: Scoped host-owned declaration CAS, plugin installation, validation, cursor-paginated history and activation tool specifications.
 * [POS]: Agent-facing authoring contract; targets come from the current Chat lease.
 */
import { z } from "zod";
import { mutation, read, type PluginToolSpec } from "../platform";

const revision = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const PLUGIN_TOOL_SPECS = [
  {
    name: "install_plugin", domainId: "plugins", access: "mutate", manualTurnOnly: true, planExcluded: true,
    description: "Install or rebuild a unified plugin from a relative folder in this source Project. The host validates bottega.plugin.json, installs declared dependencies with bundled pnpm and builds an immutable revision. Use operation=manifest with the complete declaration and expectedManifestDigest from the current validation result to change the protected declaration; identity and source provenance stay host-owned. Use operation=dependencies to install dependencies or check-dependencies to inspect them. Working versions remain available on failure.",
    inputSchema: z.object({ directory: z.string().min(1).max(512).default("."), operation: z.enum(["install", "manifest", "dependencies", "check-dependencies"]).default("install"), declaration: z.record(z.string(), z.unknown()).optional(), expectedManifestDigest: revision.optional() }).strict().superRefine((value, context) => { if (value.operation === "manifest" && (!value.declaration || !value.expectedManifestDigest)) context.addIssue({ code: "custom", message: "Manifest updates require declaration and expectedManifestDigest" }); }), annotations: mutation,
  },
  {
    name: "validate_plugin", domainId: "plugins", access: "read", manualTurnOnly: true,
    description: "Validate bottega.plugin.json and the plugin source in the current source Project. Returns bounded diagnostics without activating a revision.",
    inputSchema: z.object({}).strict(), annotations: read,
  },
  {
    name: "plugin_versions", domainId: "plugins", access: "read", manualTurnOnly: true,
    description: "Read cursor-paginated immutable revision metadata for the plugin in this source Project. Use nextCursor to continue; full source and schemas remain available in the plugin details. Multiple Chats can use the same source Project.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(25).default(10), cursor: revision.optional() }).strict(), annotations: read,
  },
  {
    name: "activate_plugin_version", domainId: "plugins", access: "mutate", manualTurnOnly: true, planExcluded: true,
    description: "Activate a retained immutable revision of the plugin in this source Project. The host checks integrity and dependency readiness; restoring code does not change business data.",
    inputSchema: z.object({ revisionId: revision }).strict(), annotations: mutation,
  },
] as const satisfies readonly PluginToolSpec[];
