/**
 * [INPUT]: Depends on Zod and standard URL parsing.
 * [OUTPUT]: Provides strict protocol-v10 encrypted-business handshakes, a boolean remote capability flag, limits, request headers and the protocol-free native-shell update metadata contract.
 * [POS]: Shared configuration boundary for desktop, Web and the private backend.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 10;
export const MAX_BLOB_BYTES = 50_000_000;
export const MAX_PART_BYTES = 8_388_608;
export const MAX_PARTS = 6;
export const CLOUD_LIMITS = Object.freeze({
  maxBlobBytes: MAX_BLOB_BYTES, maxPartBytes: MAX_PART_BYTES, maxParts: MAX_PARTS,
  maxOperationBytes: 65_536, maxOperationFields: 64, maxAtomicGroupFields: 32,
  maxRowBytes: 32_768, maxReferences: 64, maxPageBytes: 262_144, maxPageRows: 100,
  maxChunkBatchBytes: 131_072, maxFinalBytes: 262_144,
  heartbeatMs: 30_000, offlineAfterMs: 90_000, streamingWindowMs: 500,
  // The challenge covers the whole browser sign-in: account chooser, password, 2FA, code comparison and the desktop exchange.
  loginChallengeMs: 300_000,
});
export const environmentIdSchema = z.string().regex(/^cloud-(?:staging|production|sandbox-[a-z0-9-]{1,40})$/);
export const deploymentIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)+$/).max(100);
export const protocolHeaderSchema = z.object({
  environmentId: environmentIdSchema, deploymentId: deploymentIdSchema,
  protocolVersion: z.number().int().min(1).max(65535),
}).strict();
export type ProtocolHeader = z.infer<typeof protocolHeaderSchema>;
export const cloudBuildConfigSchema = z.object({
  environmentId: environmentIdSchema, deploymentId: deploymentIdSchema,
  appOrigin: z.string().url(), authOrigin: z.string().url(), convexUrl: z.string().url(),
  httpOrigin: z.string().url(), callbackScheme: z.enum(["bottega", "bottega-dev"]),
}).strict().superRefine((value, ctx) => {
  const sandbox = value.environmentId.startsWith("cloud-sandbox-");
  const production = value.environmentId === "cloud-production";
  const appOrigin = sandbox ? "http://localhost:5173" : production ? "https://app.getbottega.app" : "https://staging.getbottega.app";
  if (value.appOrigin !== appOrigin || value.authOrigin !== appOrigin ||
    value.convexUrl !== `https://${value.deploymentId}.convex.cloud` ||
    value.httpOrigin !== `https://${value.deploymentId}.convex.site` ||
    value.callbackScheme !== (production ? "bottega" : "bottega-dev")) {
    ctx.addIssue({ code: "custom", message: "environment-mismatch" });
  }
});
export type CloudBuildConfig = z.infer<typeof cloudBuildConfigSchema>;
export const publicConfigSchema = z.object({
  environmentId: environmentIdSchema, deploymentId: deploymentIdSchema,
  authOrigin: z.string().url(), minProtocolVersion: z.number().int().positive(),
  remoteControlEnabled: z.boolean(), limits: z.object(Object.fromEntries(
    Object.entries(CLOUD_LIMITS).map(([key, value]) => [key, z.literal(value)]),
  ) as { [K in keyof typeof CLOUD_LIMITS]: z.ZodLiteral<(typeof CLOUD_LIMITS)[K]> }).strict(),
}).strict();
type PublicCloudConfig = z.infer<typeof publicConfigSchema>;
/* The native shell's own axis. It is read before (and regardless of) the business handshake, so it names only the
   environment it belongs to: a Web build older or newer than the server still learns which App build it needs. */
export const deploymentHeaderSchema = protocolHeaderSchema.omit({ protocolVersion: true });
export type DeploymentHeader = z.infer<typeof deploymentHeaderSchema>;
export const updateInfoSchema = z.object({
  environmentId: environmentIdSchema, deploymentId: deploymentIdSchema,
  mobile: z.object({ minBridgeVersion: z.number().int().positive(), minAppBuild: z.number().int().positive(),
    installUrl: z.string().url().refine(value => value.startsWith("https://")).nullable() }).strict(),
}).strict();
export type UpdateInfo = z.infer<typeof updateInfoSchema>;
export function assertHandshake(expected: CloudBuildConfig, input: unknown): PublicCloudConfig {
  const config = publicConfigSchema.parse(input);
  if (config.environmentId !== expected.environmentId || config.deploymentId !== expected.deploymentId ||
      config.authOrigin !== expected.authOrigin) throw new Error("environment-mismatch");
  if (PROTOCOL_VERSION < config.minProtocolVersion) throw new Error("client-outdated");
  if (PROTOCOL_VERSION > config.minProtocolVersion) throw new Error("server-outdated");
  return config;
}
export const protocolHeader = (config: CloudBuildConfig): ProtocolHeader => ({
  environmentId: config.environmentId, deploymentId: config.deploymentId, protocolVersion: PROTOCOL_VERSION,
});
