/**
 * [INPUT]: Depends on Zod, the shared environment contract and the entitlement projection.
 * [OUTPUT]: Provides account/device projections (desktop, web and mobile kinds; desktop, browser and ios/android platforms) with the current connection epoch and the ready account's entitlements, the machine key devices register under, the account-level computer projection installations fold into with its client-side presence deadline and installation lookup, immutable login return modes and metadata, and closed product return paths.
 * [POS]: Public authentication contracts; session credentials never enter device or account DTOs.
 */
import { z } from "zod";
import { CLOUD_LIMITS, environmentIdSchema } from "../config";
import { googleAvatarUrl } from "./avatar";
import { entitlementSchema } from "../entitlements";
const hasControl = (value: string) => [...value].some(char => {
  const code = char.charCodeAt(0); return code < 32 || (code >= 127 && code <= 159);
});
export const cloudIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const loginStateSchema = z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/);
/* A computer runs a desktop platform; a Web session runs `browser`; the native mobile shell reports its OS. */
export const desktopPlatformSchema = z.enum(["macos", "windows", "linux"]);
export const mobilePlatformSchema = z.enum(["ios", "android"]);
export const devicePlatformSchema = z.enum(["macos", "windows", "linux", "browser", "ios", "android"]);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;
export const deviceKindSchema = z.enum(["desktop", "web", "mobile"]);
export type DeviceKind = z.infer<typeof deviceKindSchema>;
/** The kind a platform can register as; desktop additionally needs an acknowledged desktop login. */
export function platformDeviceKind(platform: DevicePlatform): DeviceKind {
  return platform === "browser" ? "web" : mobilePlatformSchema.safeParse(platform).success ? "mobile" : "desktop";
}
export const deviceNameSchema = z.string().min(1).max(40).refine(value => !hasControl(value), "Invalid device name");
export function normalizeDeviceName(value: string) {
  // Bounding comes last so a hostname longer than the limit still loses its mDNS `.local` suffix.
  const stripped = [...value].filter(char => !hasControl(char)).join("").replace(/\.local\s*$/i, "").trim();
  return deviceNameSchema.parse(stripped.slice(0, 40).trim());
}
export const lastSeenReasonSchema = z.enum(["sleep", "quit", "network", "unknown"]);
/* One physical computer, SHA-256 of a hardware identifier the client never discloses. Installations of the
   same computer (a second profile, a reinstall) share it; a browser or phone has none. */
export const machineIdHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const deviceSchema = z.object({
  deviceId: cloudIdSchema, kind: deviceKindSchema, name: deviceNameSchema,
  platform: devicePlatformSchema, appVersion: z.string().max(100), protocolVersion: z.number().int().positive(),
  state: z.enum(["active", "revoked"]), current: z.boolean(), createdAt: z.number(),
  presenceState: z.enum(["online", "offline"]), lastHeartbeatAt: z.number().nullable(),
  offlineAt: z.number().nullable().optional(), lastSeenReason: lastSeenReasonSchema.optional(),
}).strict();
export type CloudDevice = z.infer<typeof deviceSchema>;
/* A computer is the unit a Chat belongs to and a remote view switches between; an installation is one
   profile on it. Presence folds upwards: a computer is online while any of its installations is. */
export const computerInstallationSchema = z.object({ deviceId: cloudIdSchema, platform: devicePlatformSchema,
  appVersion: z.string().max(100), protocolVersion: z.number().int().positive(), state: z.enum(["active", "revoked"]) }).strict();
export const computerSchema = z.object({
  machineIdHash: machineIdHashSchema, name: deviceNameSchema, online: z.boolean(),
  lastSeenAt: z.number().nullable(), lastSeenReason: lastSeenReasonSchema,
  installations: z.array(computerInstallationSchema).min(1).max(100),
}).strict();
export type CloudComputer = z.infer<typeof computerSchema>;
/**
 * Presence is a deadline, not an event: the projection is only recomputed when a row changes, so a client that
 * wants a computer to go dark on time reproduces the server's rule from the newest heartbeat it was told about.
 * A computer already reported offline stays offline; only a stale "online" is retracted.
 */
export function computerOnline(computer: Pick<CloudComputer, "online" | "lastSeenAt">, now: number) {
  return computer.online && (computer.lastSeenAt === null || now < computer.lastSeenAt + CLOUD_LIMITS.offlineAfterMs);
}
/** The installation a chat or Project belongs to names exactly one computer of the account. */
export function computerOf(computers: readonly CloudComputer[], deviceId: string | null | undefined) {
  return deviceId ? computers.find(computer => computer.installations.some(item => item.deviceId === deviceId)) ?? null : null;
}
export const accountProfileSchema = z.object({ userId: cloudIdSchema, name: z.string().max(256), email: z.string().email(),
  avatarUrl: z.string().max(2048).refine(value => googleAvatarUrl(value) === value).nullable().optional() }).strict();
export const accountAccessSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("needs-bootstrap") }).strict(),
  z.object({ state: z.literal("needs-device"), profile: accountProfileSchema }).strict(),
  z.object({ state: z.literal("ready"), profile: accountProfileSchema, deviceId: cloudIdSchema, connectionEpoch: cloudIdSchema.nullable().optional(),
    entitlements: entitlementSchema }).strict(),
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
  status: loginStatusSchema, deviceNameSnapshot: deviceNameSchema, platform: desktopPlatformSchema,
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
