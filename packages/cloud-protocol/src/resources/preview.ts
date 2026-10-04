/**
 * [INPUT]: Encrypted business scope, opaque identities and bounded preview state.
 * [OUTPUT]: Preview lease functions and encrypted views with draining, durable failure reasons and development recovery hints.
 * [POS]: Cloud records routing and lease state only; hostnames and entry codes stay in encrypted resource receipts.
 */
import { z } from "zod";
import { encryptedBusinessHeaderSchema } from "../spaces";
import { id, version } from "../encryption/domains/scalars";
export const previewViewSchema = z.object({ serverId: id, sessionId: id.nullable(), chatId: id, incarnationId: id,
  state: z.enum(["captured", "running", "registering", "edge", "warm", "open", "draining", "failed", "closed"]), streaming: z.boolean(), slowLoad: z.boolean().optional(), devOriginBlocked: z.boolean().optional(),
  failure: z.enum(["tunnel-download-failed", "tunnel-component-unverified", "preview-tunnel-unavailable", "preview-service-changed"]).optional(),
  entryUrl: z.string().max(512).regex(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/__bottega\/enter#[A-Za-z0-9_-]{43}$/).optional() }).strict();
export type PreviewView = z.infer<typeof previewViewSchema>;
const scope = encryptedBusinessHeaderSchema.shape;
const lease = z.object({ sessionId: id, serverId: id, chatId: id, incarnationId: id, ownerDeviceId: id, controllerDeviceId: id,
  state: z.enum(["open", "revoked", "released"]), expiresAt: version, createdAt: version }).strict();
export const previewFunctions = {
  "preview/sessions:register": { kind: "mutation", args: z.object({ ...scope, sessionId: id, serverId: id, chatId: id, incarnationId: id, commandId: id.nullable() }).strict(), result: lease },
  "preview/sessions:renew": { kind: "mutation", args: z.object({ ...scope, sessionId: id }).strict(), result: lease },
  "preview/sessions:release": { kind: "mutation", args: z.object({ ...scope, sessionId: id }).strict(), result: z.null() },
  "preview/sessions:revoke": { kind: "mutation", args: z.object({ ...scope, sessionId: id }).strict(), result: z.null() },
  "preview/sessions:list": { kind: "query", args: z.object(scope).strict(), result: z.array(lease).max(3) },
} as const;
