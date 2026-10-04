/**
 * [INPUT]: zod and the shared relative-path rule for snapshot files.
 * [OUTPUT]: The strict one-use mount (bounded by policy.ts SURFACE_LIMITS), unmount reasons, SURFACE_OPERATIONS with typed RPC envelopes of both hops, closed RPC error codes, authenticated preferences and lease renewal.
 * [POS]: Wire contract between Cloud Web (hop 1 parent), the surface wrapper and the opaque App frame (hop 2); the decryption key never appears here.
 */
import { z } from "zod";
import { artifactRelativePathSchema } from "../turns/text/artifact-reference";
import { pluginSurfaceSubjectSchema, PLUGIN_OPERATIONS } from "./plugin/model";
import { SURFACE_LIMITS } from "./policy";

export const surfaceNonceSchema = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const appId = z.string().regex(/^[a-z0-9]{10}$/);
const generationId = z.string().regex(/^[a-z0-9]{10}-g[1-9]\d{0,8}-[a-f0-9]{12}(?:-[a-z0-9_-]{1,80})?$/);
const file = z.object({
  path: artifactRelativePathSchema, mime: z.string().min(1).max(128),
  bytes: z.custom<Uint8Array>(value => value instanceof Uint8Array && value.byteLength <= SURFACE_LIMITS.fileBytes),
}).strict();
export const surfaceEnvironmentSchema = z.object({
  language: z.string().min(2).max(35), locale: z.string().min(2).max(35), timeZone: z.string().min(1).max(64),
  colorScheme: z.enum(["light", "dark"]), reducedMotion: z.boolean(), density: z.enum(["comfortable", "compact"]),
}).strict();
export const surfaceMountSchema = z.object({
  type: z.literal("bottega:surface:mount"), nonce: surfaceNonceSchema, leaseId: surfaceNonceSchema,
  appId: appId.optional(), subject: pluginSurfaceSubjectSchema.optional(), generationId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/), artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), entry: artifactRelativePathSchema,
  expiresAt: z.number().int().positive(), environment: surfaceEnvironmentSchema,
  files: z.array(file).min(1).max(SURFACE_LIMITS.files),
}).strict().superRefine((mount, context) => {
  if (Boolean(mount.appId) === Boolean(mount.subject) || (mount.appId && (!generationId.safeParse(mount.generationId).success || !mount.generationId.startsWith(mount.appId + "-")))) context.addIssue({ code: "custom", message: "surface-generation-app" });
  const paths = new Set(mount.files.map(item => item.path));
  if (paths.size !== mount.files.length) context.addIssue({ code: "custom", message: "surface-duplicate-file" });
  if (!paths.has(mount.entry)) context.addIssue({ code: "custom", message: "surface-entry-missing" });
  if (mount.files.reduce((sum, item) => sum + item.bytes.byteLength, 0) > SURFACE_LIMITS.totalBytes) context.addIssue({ code: "custom", message: "surface-resource-budget" });
});
export type SurfaceMount = z.infer<typeof surfaceMountSchema>;
export const SURFACE_UNMOUNT_REASONS = ["released", "expired", "generation-stale", "revoked", "scope-changed"] as const;
export const surfaceUnmountSchema = z.object({ type: z.literal("bottega:surface:unmount"), nonce: surfaceNonceSchema, reason: z.enum(SURFACE_UNMOUNT_REASONS) }).strict();
export const SURFACE_ERRORS = ["mount-invalid", "prepare-failed", "expired"] as const;
/* Hop 2: the only messages a wrapper accepts from its App frame, each carrying the frame nonce from the Blob URL fragment. */
export const SURFACE_APP_MESSAGES = ["bottega:surface:ready"] as const;
export const surfaceAppMessageSchema = z.object({ type: z.enum(SURFACE_APP_MESSAGES), frameNonce: surfaceNonceSchema }).strict();
/* The desktop SDK's operation names; the Web host answers each one or refuses it with a typed code, never silence. */
export const SURFACE_OPERATIONS = ["base.meta", "base.rows", "base.query-v1", "base.mutation", "attachment.read", "preferences.read", "preferences.write",
  "workspace.files", "workspace.versions", "workspace.source-line", "workspace.preview", "host.action", ...PLUGIN_OPERATIONS] as const;
export type SurfaceOperation = (typeof SURFACE_OPERATIONS)[number];
/* The desktop Base GUI API's top-level codes (apps/desktop/electron/main/apps/base-gui/api), so a Web refusal reads like a desktop one. */
export const SURFACE_SDK_ERRORS = ["capability_not_granted", "generation_draining", "base_not_found", "read_failed", "commit_uncertain",
  "query_invalid", "query_column_invalid", "query_aggregation_invalid", "query_budget_exceeded", "query_cursor_invalid", "query_revision_changed",
  "query_timeout", "query_snapshot_invalid", "query_unavailable", "base_instance_changed", "attachment_not_found",
  "mutation_busy", "batch_too_large", "body_too_large", "invalid_rows", "revision_conflict", "row_id_conflict", "duplicate_row_id", "row_not_found",
  "base_capacity", "preferences_unavailable", "preference_invalid", "preference_limit"] as const;
export const SURFACE_RPC_ERRORS = ["permission_denied", "unsupported_on_web", "scope_denied", "generation_stale", "lease_ended", "invalid_envelope", "busy", "unavailable",
  ...SURFACE_SDK_ERRORS] as const;
export type SurfaceRpcErrorCode = (typeof SURFACE_RPC_ERRORS)[number];
const requestId = z.string().regex(/^rpc_[a-z0-9_]{8,64}$/);
const payload = z.unknown().refine(value => { try { return new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength <= SURFACE_LIMITS.rpcBytes; } catch { return false; } });
const rpc = { type: z.literal("bottega:surface:rpc"), requestId, operation: z.enum(SURFACE_OPERATIONS), payload };
export const surfaceAppRpcSchema = z.object({ ...rpc, frameNonce: surfaceNonceSchema }).strict();
export const surfaceHostRpcSchema = z.object({ ...rpc, nonce: surfaceNonceSchema }).strict();
const issue = z.object({ rowIndex: z.number().int().min(0).optional(), rowId: z.string().max(128).optional(), columnId: z.string().max(128).optional(),
  field: z.string().max(128).optional(),
  reason: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/) }).strict();
/** The desktop SDK error body, bounded: message, commit outcome, at most 20 issues, the current Base revision and the HTTP status. */
export const surfaceRpcErrorDetailSchema = z.object({ message: z.string().max(500).optional(), outcome: z.enum(["not-committed", "unknown"]).optional(),
  issues: z.array(issue).max(20).optional(), currentRevision: z.number().int().min(0).optional(),
  /* The HTTP status the desktop API would have answered with, so SDK retry rules keyed on it behave the same over the bridge. */
  status: z.number().int().min(400).max(599).optional() }).strict();
export type SurfaceRpcErrorDetail = z.infer<typeof surfaceRpcErrorDetailSchema>;
export const surfaceRpcResultSchema = z.object({
  type: z.literal("bottega:surface:rpc-result"), nonce: surfaceNonceSchema, requestId, ok: z.boolean(), value: payload.optional(),
  error: z.object({ code: z.enum(SURFACE_RPC_ERRORS), reason: z.string().max(200).optional(), detail: surfaceRpcErrorDetailSchema.optional() }).strict().optional(),
}).strict().refine(result => result.ok ? result.error === undefined : result.error !== undefined && result.value === undefined);
export type SurfaceRpcResult = z.infer<typeof surfaceRpcResultSchema>;
/* The host extends a live lease; the wrapper still caps it at SURFACE_LIMITS.leaseMs from now. */
export const surfaceRenewSchema = z.object({ type: z.literal("bottega:surface:renew"), nonce: surfaceNonceSchema, expiresAt: z.number().int().positive() }).strict();

/** Locale/theme changes keep the same generation and editor state. */
export const surfacePreferencesValueSchema = z.object({locale:z.string().min(2).max(35),theme:z.enum(["light","dark"])}).strict();
export type SurfacePreferences = z.infer<typeof surfacePreferencesValueSchema>;
export const surfacePreferencesSchema = z.object({type:z.literal("bottega:surface:preferences"),nonce:surfaceNonceSchema,preferences:surfacePreferencesValueSchema}).strict();
