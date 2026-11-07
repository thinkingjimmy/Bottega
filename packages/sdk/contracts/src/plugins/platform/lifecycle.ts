/**
 * [INPUT]: Zod, plugin identities and manifest contribution types.
 * [OUTPUT]: Side-effect-separated service, trusted RPC, authoring owner and persistent member contracts.
 * [POS]: Host/plugin execution boundary; filesystem and process proxies must share the sensitive-path policy.
 */
import { z } from "zod";
import { pluginDigestSchema, pluginIdentitySchema } from "./manifest";

export const PLUGIN_RUNTIME_CONTRACT = 1 as const;
export const PLUGIN_SENSITIVE_PATH_POLICY = "bottega-sensitive-paths/v1" as const;
export const pluginServicePhaseSchema = z.enum(["unprepared", "preparing", "prepared", "active", "draining", "disposed", "failed"]);
export type PluginServicePhase = z.infer<typeof pluginServicePhaseSchema>;
export type PluginServiceContext = Readonly<{
  pluginId: string; revision: string; activationId: string; signal: AbortSignal;
}>;
export type PluginServiceRuntime = Readonly<{
  /** Validate and allocate only. No writes, consumption, timers or external side effects. */
  prepare(context: PluginServiceContext): Promise<void>;
  activate(context: PluginServiceContext): Promise<void>;
  drain(context: PluginServiceContext): Promise<void>;
  dispose(context: PluginServiceContext): Promise<void>;
}>;
export const pluginHostRpcRequestSchema = z.object({
  contract: z.literal(PLUGIN_RUNTIME_CONTRACT), id: pluginIdentitySchema, pluginId: pluginIdentitySchema,
  revision: pluginDigestSchema, activationId: pluginIdentitySchema,
  operation: z.string().min(1).max(160), input: z.unknown(),
  phase: z.enum(["prepare", "active", "drain"]), sensitivePathPolicy: z.literal(PLUGIN_SENSITIVE_PATH_POLICY),
}).strict();
export const pluginHostRpcResponseSchema = z.discriminatedUnion("ok", [
  z.object({ id: pluginIdentitySchema, ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ id: pluginIdentitySchema, ok: z.literal(false), error: z.object({
    code: z.enum(["not-active", "sensitive-path", "cancelled", "timeout", "unavailable", "invalid-input", "failed"]),
    message: z.string().max(2048),
  }).strict() }).strict(),
]);
export type PluginHostRpcRequest = z.infer<typeof pluginHostRpcRequestSchema>;
export type PluginHostRpcResponse = z.infer<typeof pluginHostRpcResponseSchema>;
export type PluginHostApi = Readonly<{
  pluginId: string; revision: string;
  call(operation: string, input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
}>;
export const pluginAuthoringLeaseOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("turn"), operationId: pluginIdentitySchema, chatId: pluginIdentitySchema, incarnation: pluginIdentitySchema }).strict(),
  z.object({ kind: z.literal("team"), operationId: pluginIdentitySchema, leadChatId: pluginIdentitySchema, leadIncarnation: pluginIdentitySchema }).strict(),
]);
export type PluginAuthoringLeaseOwner = z.infer<typeof pluginAuthoringLeaseOwnerSchema>;
export const pluginMemberSessionSchema = z.object({
  pluginId: pluginIdentitySchema, leadChatId: pluginIdentitySchema, leadIncarnation: pluginIdentitySchema,
  projectId: pluginIdentitySchema, chatId: pluginIdentitySchema, incarnation: pluginIdentitySchema,
  memberId: pluginIdentitySchema, name: z.string().min(1).max(160), providerId: z.string().min(1).max(128),
  status: z.enum(["idle", "running", "stopping", "stopped", "failed"]), createdAt: z.number().int().nonnegative(),
}).strict();
export const pluginMemberMessageSchema = z.object({
  id: pluginIdentitySchema, pluginId: pluginIdentitySchema, leadChatId: pluginIdentitySchema,
  leadIncarnation: pluginIdentitySchema, senderChatId: pluginIdentitySchema,
  targetChatId: pluginIdentitySchema, targetIncarnation: pluginIdentitySchema,
  body: z.string().min(1).max(32_768),
  status: z.enum(["queued", "inserted", "delivered", "unknown", "processed", "cancelled"]),
  consumptionId: pluginIdentitySchema.optional(), processedAt: z.number().int().nonnegative().optional(),
  createdAt: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
  if (value.status === "processed" && (!value.consumptionId || value.processedAt === undefined))
    context.addIssue({ code: "custom", message: "Processed messages require explicit consumption and acknowledgement" });
});
export type PluginMemberSession = z.infer<typeof pluginMemberSessionSchema>;
export type PluginMemberMessage = z.infer<typeof pluginMemberMessageSchema>;
export type PluginMemberSessionPort = Readonly<{
  create(input: Omit<PluginMemberSession, "chatId" | "incarnation" | "status" | "createdAt"> & { task: string; forkChatId?: string }): Promise<PluginMemberSession>;
  submit(input: { chatId: string; incarnation: string; messageId: string; text: string }): Promise<{ outcome: "inserted" | "not-consumed" | "unknown" | "queued"; turnId?: string }>;
  stop(input: { chatId: string; incarnation: string }): Promise<void>;
  status(input: { chatId: string; incarnation: string }): Promise<PluginMemberSession["status"]>;
  recover(input: { pluginId: string; leadChatId: string; leadIncarnation: string }): Promise<PluginMemberSession[]>;
}>;
