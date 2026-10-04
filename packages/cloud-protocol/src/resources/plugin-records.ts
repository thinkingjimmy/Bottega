/**
 * [INPUT]: Public record target/call contracts and Zod.
 * [OUTPUT]: Bounded encrypted record requests and digest-bound reply pages.
 * [POS]: Same-account resource-command adapter; Base identities and payloads stay inside ciphertext.
 */
import { z } from "zod";
import { recordCallSchema, recordOpenSchema, recordTargetSchema } from "@bottega/contracts/plugins/records/contract";

export const RECORD_REPLY_PAGE_BYTES = 4096;
export const RECORD_REPLY_MAX_BYTES = 262_144;
const offset = z.number().int().min(0).max(RECORD_REPLY_MAX_BYTES);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const page = { offset, digest: digest.optional() };
export const pluginRecordReadSchema = z.object({ target: recordOpenSchema, call: recordCallSchema.refine(call => call.operation !== "base.results.report"), ...page }).strict();
export const pluginRecordReportSchema = z.object({ target: recordOpenSchema, call: recordCallSchema.refine(call => call.operation === "base.results.report") }).strict();
export const pluginRecordResultsSchema = z.object({ target: recordTargetSchema,
  read: z.object({ resultRef: z.string().regex(/^res_[a-f0-9]{64}$/), offset: z.number().int().min(0).max(4 * 1024 * 1024) }).strict().optional(), ...page }).strict();
export const pluginRecordPageSchema = z.object({ offset, total: z.number().int().min(1).max(RECORD_REPLY_MAX_BYTES), digest,
  chunk: z.string().min(1).max(5464).regex(/^[A-Za-z0-9+/]+={0,2}$/), done: z.boolean() }).strict();
export type PluginRecordPage = z.infer<typeof pluginRecordPageSchema>;
