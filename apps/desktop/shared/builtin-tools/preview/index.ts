/**
 * [INPUT]: Zod and the domain-neutral tool platform.
 * [OUTPUT]: PREVIEW_TOOL_SPECS for managed service lifecycle.
 * [POS]: Agent inputs select argv and a relative directory, never execution authority or another Chat.
 */
import { z } from "zod";
import { mutation, read, type BuiltinToolSpec } from "../platform";
export const PREVIEW_TOOL_SPECS = [
  { name: "preview_server_start", domainId: "preview", access: "mutate", manualTurnOnly: true, planExcluded: true,
    description: "Start a managed loopback application inside this Chat's frozen workspace fence. It survives this reply. Bind exactly 127.0.0.1 on the declared port. Use dev mode while editing; build the application first and use its preview command in build mode for faster sharing. Return the provided artifact fence in your reply. The user explicitly enables remote access.",
    inputSchema: z.object({ argv: z.array(z.string().max(4096)).min(1).max(32), cwd: z.string().min(1).max(512).default("."),
      port: z.number().int().min(1024).max(65535), mode: z.enum(["dev", "build"]).default("dev"), title: z.string().min(1).max(120).default("Live application") }).strict(), annotations: mutation },
  { name: "preview_server_stop", domainId: "preview", access: "mutate", manualTurnOnly: true, planExcluded: true,
    description: "Stop a managed application belonging to this Chat and immediately revoke its remote preview.",
    inputSchema: z.object({ serverId: z.string().uuid() }).strict(), annotations: mutation },
  { name: "preview_server_list", domainId: "preview", access: "read", manualTurnOnly: true,
    description: "List this Chat's managed applications and their current state. Does not start a service or grant remote access.",
    inputSchema: z.object({}).strict(), annotations: read },
] as const satisfies readonly BuiltinToolSpec[];
