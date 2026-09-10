/**
 * [INPUT]: Depends on Zod and the closed Agent order.
 * [OUTPUT]: Validates bounded, main-window quota demand and refresh requests.
 * [POS]: IPC input boundary; accepts no commands, URLs, paths or account identifiers.
 */
import { z } from "zod";
import { AGENT_BACKEND_ORDER } from "../agent-ipc";
const backend = z.enum(AGENT_BACKEND_ORDER);
export const limitsDemandSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9:_-]{1,96}$/),
  active: z.boolean(),
  mode: z.enum(["settings", "selector"]),
  backends: z.array(backend).min(1).max(AGENT_BACKEND_ORDER.length)
    .refine((values) => new Set(values).size === values.length),
}).strict();
export const limitsRefreshSchema = z.object({ backend: backend.optional() }).strict();
