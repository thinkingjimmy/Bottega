/**
 * [INPUT]: Depends on Zod only.
 * [OUTPUT]: Provides the account entitlement projection (plan, state, per-feature switches, limits, deadline), the four gated action classes, the free default `FREE_ENTITLEMENT`, the closed refusal codes and `entitlementAllows`, the one policy both the server gate and client renderers read.
 * [POS]: Commercial seam of the cloud protocol; today every account resolves to the free, fully allowed projection, so paid launch changes data and copy, never this contract.
 */
import { z } from "zod";
export const entitlementActionSchema = z.enum(["read", "write", "execute", "push"]);
export type EntitlementAction = z.infer<typeof entitlementActionSchema>;
/* Structured refusals: a denied state or feature, or an exhausted metered limit. Both are terminal for the attempt and
   keep the user's input; neither is a transport failure a client should retry on its own. */
export const entitlementRefusalSchema = z.enum(["entitlement-required", "quota-exceeded"]);
export type EntitlementRefusal = z.infer<typeof entitlementRefusalSchema>;
/* `grace` still works; `readOnly` and `expired` keep reading what is already synced (local-first: the desktop's own
   truth is never gated) while new writes, remote execution and push stop. */
export const entitlementStateSchema = z.enum(["active", "grace", "readOnly", "expired"]);
const limit = z.number().int().nonnegative().nullable();
export const entitlementSchema = z.object({
  plan: z.enum(["free"]), state: entitlementStateSchema,
  features: z.object({ sync: z.boolean(), remoteControl: z.boolean(), mobile: z.boolean(), push: z.boolean() }).strict(),
  /* null means unlimited. */
  limits: z.object({ storageBytes: limit, commandsPerDay: limit, devices: limit }).strict(),
  until: z.number().nullable(),
}).strict();
export type Entitlement = z.infer<typeof entitlementSchema>;
/** What every account resolves to until paid plans exist. */
export const FREE_ENTITLEMENT: Entitlement = Object.freeze({ plan: "free", state: "active",
  features: Object.freeze({ sync: true, remoteControl: true, mobile: true, push: true }),
  limits: Object.freeze({ storageBytes: null, commandsPerDay: null, devices: null }), until: null }) as Entitlement;
const actionFeature = { read: null, write: "sync", execute: "remoteControl", push: "push" } as const;
/** Reading synced content and existing receipts survives every state; everything else needs a working plan and its feature. */
export function entitlementAllows(entitlement: Entitlement, action: EntitlementAction) {
  if (action === "read") return true;
  const feature = actionFeature[action];
  return (entitlement.state === "active" || entitlement.state === "grace") && entitlement.features[feature];
}
