/**
 * [INPUT]: Zod and the record operation vocabulary.
 * [OUTPUT]: Bounded record action declarations for manifests and encrypted catalogs.
 * [POS]: Lightweight catalog metadata; imports no Base identity or RPC payload validators.
 */
import { z } from "zod";
import { RECORD_SURFACE_OPERATIONS } from "./operations";
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
export const recordUiSchema = z.object({
  actions: z.array(z.object({ id, title: z.string().min(1).max(80) }).strict()).min(1).max(8),
  operations: z.array(z.enum(RECORD_SURFACE_OPERATIONS)).min(2).max(RECORD_SURFACE_OPERATIONS.length),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.actions.map(action => action.id)).size !== value.actions.length || new Set(value.operations).size !== value.operations.length)
    ctx.addIssue({ code: "custom", message: "record-ui-duplicate" });
  if (!value.operations.includes("plugin.open") || !value.operations.includes("plugin.heartbeat"))
    ctx.addIssue({ code: "custom", message: "record-ui-bootstrap-required" });
});
export type RecordUi = z.infer<typeof recordUiSchema>;
