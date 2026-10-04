/**
 * [INPUT]: Depends on Zod and the bounded Provider id.
 * [OUTPUT]: Validates bounded, main-window quota demand, refresh and route-config reveal requests.
 * [POS]: IPC input boundary; accepts no commands, URLs, paths or account identifiers. Ids are bounded, not a closed list: main decides which Providers have quota and drops the rest (TASK-13 C).
 */
import { z } from "zod";
import { providerIdSchema } from "@ai-chat/cloud-protocol/contracts/provider-id-schema";
/* A plain bounded id, never cast to a built-in: the service narrows it with known() and leaves out (and logs) one it does not read. */
const backend = providerIdSchema;
export const limitsDemandSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9:_-]{1,96}$/),
  active: z.boolean(),
  mode: z.enum(["settings", "selector", "prefetch"]),
  backends: z.array(backend).min(1).max(16)
    .refine((values) => new Set(values).size === values.length).optional(),
}).strict();
export const limitsRefreshSchema = z.object({ backend: backend.optional() }).strict();
/** Names a Provider only: main resolves the file it routes by, the renderer never sends a path. */
export const limitsRevealSchema = z.object({ backend }).strict();
