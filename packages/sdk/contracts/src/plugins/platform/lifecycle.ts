/**
 * [INPUT]: Zod, plugin identities and manifest contribution types.
 * [OUTPUT]: Provides PLUGIN_RUNTIME_CONTRACT, PLUGIN_SENSITIVE_PATH_POLICY, pluginServicePhaseSchema, PluginServicePhase, PluginServiceContext, PluginServiceRuntime, pluginHostRpcRequestSchema, pluginHostRpcResponseSchema, PluginHostRpcRequest, PluginHostRpcResponse, PluginHostApi, pluginAuthoringLeaseOwnerSchema, PluginAuthoringLeaseOwner.
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
export const pluginAuthoringLeaseOwnerSchema = z.object({
  kind: z.literal("turn"), operationId: pluginIdentitySchema, chatId: pluginIdentitySchema, incarnation: pluginIdentitySchema,
}).strict();
export type PluginAuthoringLeaseOwner = z.infer<typeof pluginAuthoringLeaseOwnerSchema>;
