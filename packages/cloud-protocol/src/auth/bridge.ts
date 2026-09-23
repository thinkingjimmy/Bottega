/**
 * [INPUT]: Depends on closed account, display and environment schemas.
 * [OUTPUT]: Defines strict desktop authentication requests, return-mode projections and the supported HTTP contract marker.
 * [POS]: Auth transport contract; secret-bearing results must never enter renderer projections.
 */
import { z } from "zod";
import { protocolHeaderSchema } from "../config";
import { accountProfileSchema, desktopPlatformSchema, loginMetadataSchema, loginStateSchema, loginStatusSchema, loginReturnModeSchema } from "./index";
export const DESKTOP_AUTH_CONTRACT_HEADER = "X-Bottega-Desktop-Auth";
export const DESKTOP_AUTH_CONTRACT_VERSION = "return-mode-v1";
export const verifierSchema = z.string().min(43).max(128).regex(/^[A-Za-z0-9._~-]+$/);
const exchangeIdSchema = z.string().uuid();
const request = protocolHeaderSchema.extend({ state: loginStateSchema });
const proof = request.extend({ verifier: verifierSchema });
const status = z.object({ status: loginStatusSchema }).strict();
const delivery = status.extend({ deliveryDeadline: z.number().optional() });
export const desktopMetadataSchema = z.union([
  loginMetadataSchema.extend({ status: z.enum(["pending", "approved"]) }),
  z.object({ status: z.enum(["consumed", "acknowledged", "cancelled", "expired"]), returnMode: loginReturnModeSchema }).strict(),
]);
export const desktopAuth = {
  start: { method: "POST", path: "/api/auth/desktop/start", args: request.extend({
    returnMode: loginReturnModeSchema, codeChallenge: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/), callback: z.enum(["bottega-dev://auth/callback", "bottega://auth/callback"]),
    deviceNameSnapshot: z.string().min(1).max(120), platform: desktopPlatformSchema,
    // A resent identical request is the same challenge, so an already approved row answers with its original metadata.
  }), result: loginMetadataSchema.extend({ status: z.enum(["pending", "approved"]) }) },
  metadata: { method: "GET", path: "/api/auth/desktop/metadata", args: request, result: desktopMetadataSchema },
  approve: { method: "POST", path: "/api/auth/desktop/approve", args: request, result: status },
  reject: { method: "POST", path: "/api/auth/desktop/reject", args: request, result: status },
  status: { method: "POST", path: "/api/auth/desktop/status", args: proof,
    result: z.union([z.object({ status: z.literal("approved"), code: loginStateSchema }).strict(),
      z.object({ status: z.enum(["pending", "consumed", "acknowledged", "cancelled", "expired"]) }).strict()]) },
  exchange: { method: "POST", path: "/api/auth/desktop/exchange", args: proof.extend({ code: loginStateSchema, exchangeId: exchangeIdSchema }),
    result: z.object({ bearer: z.string().min(20).max(1024), issuedSessionId: z.string().min(1).max(128), exchangeId: exchangeIdSchema,
      deliveryDeadline: z.number(), profile: accountProfileSchema }).strict() },
  exchangeStatus: { method: "POST", path: "/api/auth/desktop/exchange-status", args: proof.extend({ exchangeId: exchangeIdSchema }), result: delivery },
  ack: { method: "POST", path: "/api/auth/desktop/ack", args: protocolHeaderSchema.extend({ exchangeId: exchangeIdSchema }),
    result: z.object({ status: z.literal("acknowledged") }).strict() },
  cancel: { method: "POST", path: "/api/auth/desktop/cancel", args: proof, result: status },
  token: { method: "GET", path: "/api/auth/convex/token", args: z.object({}).strict(), result: z.object({ token: z.string().min(1) }).strict() },
} as const;
export type DesktopAuthName = keyof typeof desktopAuth;
export type DesktopAuthArgs<N extends DesktopAuthName> = z.infer<(typeof desktopAuth)[N]["args"]>;
export type DesktopAuthResult<N extends DesktopAuthName> = z.infer<(typeof desktopAuth)[N]["result"]>;
