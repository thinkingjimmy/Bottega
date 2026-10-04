/**
 * [INPUT]: Zod, the public Base identity contract and the lightweight operation vocabulary.
 * [OUTPUT]: Strict record UI contributions and bounded, host-bound message contracts.
 * [POS]: Shared package author/Desktop/Web record slot boundary; no Chat or native capability.
 */
import { recordUiSchema } from "./definition";
export { recordUiSchema, type RecordUi } from "./definition";
export { RECORD_SURFACE_OPERATIONS } from "./operations";
import { z } from "zod";
import { baseRefSchema } from "../../model/resources";

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);

export const recordTargetSchema = z.object({ base: baseRefSchema, rowId: id }).strict();
export type RecordTarget = z.infer<typeof recordTargetSchema>;
export const recordOpenSchema = recordTargetSchema.extend({ pluginId: id, generationId: id, actionId: id }).strict();
export type RecordOpen = z.infer<typeof recordOpenSchema>;
const empty = z.object({}).strict();
export const recordCallSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("base.record.read"), payload: empty }).strict(),
  z.object({ operation: z.literal("base.results.list"), payload: empty }).strict(),
  z.object({ operation: z.literal("plugin.settings.read"), payload: empty }).strict(),
  z.object({ operation: z.literal("base.results.read"), payload: z.object({ resultRef: z.string().regex(/^res_[a-f0-9]{64}$/), offset: z.number().int().min(0).max(4 * 1024 * 1024) }).strict() }).strict(),
  z.object({ operation: z.literal("base.results.report"), payload: z.object({ requestId: id, label: z.string().min(1).max(120), report: z.string().min(1).max(16_384) }).strict() }).strict(),
]);
export type RecordCall = z.infer<typeof recordCallSchema>;
export const recordEntrySchema = z.object({ id, name: z.string().min(1).max(160), generationId: id, enabled: z.boolean(), records: recordUiSchema }).strict();
export type RecordEntry = z.infer<typeof recordEntrySchema>;
