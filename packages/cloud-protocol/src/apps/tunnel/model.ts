/**
 * [INPUT]: Zod, opaque identifiers and exact HTTPS Quick Tunnel origins.
 * [OUTPUT]: Dormant server surface, open/close command and grant schemas.
 * [POS]: S7 test-build contract; not a production resource kind, action or surface variant.
 */
import { z } from "zod";
export const SERVER_TUNNEL_MARKER = "bottega-server-tunnel-v1";
export const serverSurfaceSchema = z.object({ kind: z.literal("server"), wsDeclared: z.boolean() }).strict();
export const tunnelCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open-tunnel"), surfaceLeaseId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("close-tunnel"), grantId: z.string().uuid() }).strict(),
]);
export const tunnelGrantSchema = z.object({ grantId: z.string().uuid(),
  tunnelUrl: z.string().regex(/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/),
  sessionKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: z.number().int().positive(), idleSeconds: z.number().int().min(1).max(1800),
  wsDeclared: z.boolean() }).strict();
export type TunnelGrant = z.infer<typeof tunnelGrantSchema>;
export const TUNNEL_LIMITS = Object.freeze({ request: 8 * 1024 * 1024, response: 32 * 1024 * 1024, frame: 1024 * 1024,
  connections: 4, requestMs: 60_000, idleMs: 30 * 60_000, lifetimeMs: 60 * 60_000 });
