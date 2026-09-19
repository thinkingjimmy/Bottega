/**
 * [INPUT]: Depends on Zod and the shared environment contract.
 * [OUTPUT]: Provides account/device projections with the current connection epoch, immutable login return modes and metadata, and closed product return paths.
 * [POS]: Public authentication contracts; session credentials never enter device or account DTOs.
 */
import { z } from "zod";
import { environmentIdSchema } from "../config";
import { googleAvatarUrl } from "./avatar";
const hasControl = (value: string) => [...value].some(char => {
  const code = char.charCodeAt(0); return code < 32 || (code >= 127 && code <= 159);
});
export const cloudIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const loginStateSchema = z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const devicePlatformSchema = z.enum(["macos", "windows", "linux", "browser"]);
export const deviceNameSchema = z.string().min(1).max(40).refine(value => !hasControl(value), "Invalid device name");
export function normalizeDeviceName(value: string) {
  return deviceNameSchema.parse([...value].filter(char => !hasControl(char)).join("").replace(/\.local\s*$/i, "").trim());
}
export const lastSeenReasonSchema = z.enum(["sleep", "quit", "network", "unknown"]);
export const deviceSchema = z.object({
  deviceId: cloudIdSchema, kind: z.enum(["desktop", "web"]), name: deviceNameSchema,
  platform: devicePlatformSchema, appVersion: z.string().max(100), protocolVersion: z.number().int().positive(),
  state: z.enum(["active", "revoked"]), current: z.boolean(), createdAt: z.number(),
  presenceState: z.enum(["online", "offline"]), lastHeartbeatAt: z.number().nullable(),
  offlineAt: z.number().nullable().optional(), lastSeenReason: lastSeenReasonSchema.optional(),
}).strict();
export type CloudDevice = z.infer<typeof deviceSchema>;
export const accountProfileSchema = z.object({ userId: cloudIdSchema, name: z.string().max(256), email: z.string().email(),
  avatarUrl: z.string().max(2048).refine(value => googleAvatarUrl(value) === value).nullable().optional() }).strict();
export const accountAccessSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("needs-bootstrap") }).strict(),
  z.object({ state: z.literal("needs-device"), profile: accountProfileSchema }).strict(),
  z.object({ state: z.literal("ready"), profile: accountProfileSchema, deviceId: cloudIdSchema, connectionEpoch: cloudIdSchema.nullable().optional() }).strict(),
  z.object({ state: z.literal("revoked") }).strict(),
  z.object({ state: z.literal("signed-out") }).strict(),
  z.object({ state: z.literal("suspended") }).strict(),
  z.object({ state: z.literal("deleting") }).strict(),
]);
export type AccountAccess = z.infer<typeof accountAccessSchema>;
export const loginStatusSchema = z.enum(["pending", "approved", "consumed", "acknowledged", "cancelled", "expired"]);
export const loginReturnModeSchema = z.enum(["protocol", "polling-only"]);
export type LoginReturnMode = z.infer<typeof loginReturnModeSchema>;
export const loginMetadataSchema = z.object({
  returnMode: loginReturnModeSchema,
  status: loginStatusSchema, deviceNameSnapshot: deviceNameSchema, platform: devicePlatformSchema,
  environmentId: environmentIdSchema, verificationCode: z.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/),
  expiresAt: z.number(),
}).strict();
export function safeReturnTo(input: unknown): string {
  if (typeof input !== "string" || input.length > 2048 || !input.startsWith("/") || input.startsWith("//") ||
    input.includes("\\") || input.includes(" ") || hasControl(input) || /%(?:2f|5c|00|0a|0d)/i.test(input)) return "/";
  try {
    const url = new URL(input, "https://app.invalid");
    if (url.origin !== "https://app.invalid" || url.hash || input.split("?")[0] !== url.pathname ||
      [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) return "/";
    if (url.pathname === "/auth/desktop" && [...url.searchParams.keys()].length === 1 &&
      loginStateSchema.safeParse(url.searchParams.get("state")).success) return url.pathname + url.search;
    if (url.pathname === "/account/delete") {
      const query = z.object({ account: cloudIdSchema.optional(), request: z.string().uuid().optional() }).strict();
      return query.safeParse(Object.fromEntries(url.searchParams)).success ? url.pathname + url.search : "/";
    }
    if (!/^\/(?:account|settings|archive|apps(?:\/[a-zA-Z0-9_-]+)?|(?:chats|projects|bases)\/[a-zA-Z0-9_-]+)?$/.test(url.pathname)) return "/";
    const keys = url.pathname === "/" || url.pathname === "/chats/new" ? ["projectId"] : url.pathname.startsWith("/chats/") ? ["messageId"] : url.pathname.startsWith("/bases/") || url.pathname.startsWith("/apps/") ? ["view", "record"] : [];
    if ([...url.searchParams.keys()].some(key => !keys.includes(key))) return "/";
    if ([...url.searchParams.values()].some(value => !/^[a-zA-Z0-9_-]{1,200}$/.test(value))) return "/";
    return url.pathname + url.search;
  } catch { return "/"; }
}
