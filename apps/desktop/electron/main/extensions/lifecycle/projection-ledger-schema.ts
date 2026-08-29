/**
 * [INPUT]: Depends on zod plus canonical Extension digest, generation, owner, and backend identity contracts
 * [OUTPUT]: Provides the schema-v5 Projection Ledger shape, inferred records, and fail-closed relational validation
 * [POS]: Persistence boundary for projection-ledger; runtime mutation stays in projection-ledger.ts while impossible durable graphs are rejected here
 */

import { z } from "zod";
import {
  SHA256_DIGEST_IDENTITY_PATTERN,
  type Sha256Digest,
} from "../../../../shared/extensions-ipc";

const digestSchema = z
  .string()
  .regex(SHA256_DIGEST_IDENTITY_PATTERN)
  .transform((value) => value as Sha256Digest);
const identitySchema = z.string().regex(SHA256_DIGEST_IDENTITY_PATTERN);

const ownerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }).strict(),
  z.object({ kind: z.literal("app"), appId: z.string().min(1) }).strict(),
]);

export const projectionDeliverySchema = z.object({
  backend: z.enum(["codex", "claude", "kimi", "opencode"]),
  transport: z.literal("filesystem"),
  runtimeIdentity: z.string().min(1),
  deliveryIdentity: digestSchema,
}).strict();

const generationRefSchema = z.object({
  packageGenerationId: z.string().min(1),
  recordDigest: digestSchema,
}).strict();

const consentSchema = z.object({
  consentId: z.string().min(1),
  owner: ownerSchema,
  workspaceKey: z.string().min(1),
  workspaceCapabilityId: z.string().min(1),
  canonicalIdentityDigest: digestSchema,
  grantedAt: z.number().int().nonnegative(),
  revokedAt: z.number().int().nonnegative().nullable(),
}).strict();

const leaseSchema = z.object({
  leaseId: z.string().min(1),
  owner: ownerSchema,
  workspaceConsentId: z.string().min(1),
  acquiredAt: z.number().int().nonnegative(),
}).strict();

const bindingSchema = z.object({
  bindingId: z.string().min(1),
  installIdentity: identitySchema,
  packageGenerationRef: generationRefSchema,
  componentInstanceIdentity: identitySchema,
  delivery: projectionDeliverySchema,
  projectionId: z.string().min(1),
  workspaceKey: z.string().min(1),
  targetPath: z.string().min(1),
  artifactDigest: digestSchema,
  owners: z.array(ownerSchema),
  leases: z.array(leaseSchema),
  state: z.enum(["active", "revoke-pending", "revoked", "foreign"]),
  revokedByOperationId: z.string().min(1).nullable(),
}).strict();

const sessionDiscoverySchema = z.object({
  kind: z.literal("ambient-projection"),
  receiptId: z.string().uuid(),
  conversationId: z.string().min(1),
  backend: z.enum(["codex", "claude", "kimi", "opencode"]),
  backendRuntimeIdentity: z.string().min(1),
  sessionId: z.string().min(1),
  workspaceKey: z.string().min(1),
  bindingId: z.string().min(1),
  installIdentity: identitySchema,
  packageGenerationRef: generationRefSchema,
  componentInstanceIdentity: identitySchema,
  deliveryIdentity: digestSchema,
  acquiredAt: z.number().int().nonnegative(),
  releasedAt: z.number().int().nonnegative().nullable(),
  revokedByOperationId: z.string().min(1).nullable(),
}).strict();

export const projectionAdmissionSchema = z.object({
  installIdentity: identitySchema,
  packageGenerationRef: generationRefSchema,
  componentInstanceIdentity: identitySchema,
  delivery: projectionDeliverySchema,
  admittedAt: z.number().int().nonnegative(),
}).strict();

const bindingAuthoritySchema = z.object({
  authorityToken: z.string().min(1),
  agent: z.enum(["codex", "claude", "kimi", "opencode"]),
  component: z.string().min(1),
  target: z.string().min(1),
  digest: digestSchema,
  action: z.enum(["project", "takeover", "remove"]),
  expiresAt: z.number().int().nonnegative(),
  consumedAt: z.number().int().nonnegative().nullable(),
}).strict();

export const projectionLedgerSchema = z.object({
  schemaVersion: z.literal(5),
  consents: z.array(consentSchema),
  bindings: z.array(bindingSchema),
  sessionDiscoveries: z.array(sessionDiscoverySchema).default([]),
  projectionAdmissions: z.array(projectionAdmissionSchema).default([]),
  authorities: z.array(bindingAuthoritySchema).default([]),
}).strict().superRefine((ledger, context) => {
  const issue = (path: (string | number)[], message: string) =>
    context.addIssue({ code: "custom", path, message });
  const consentIds = new Set<string>();
  const activeConsents = new Set<string>();
  for (const [index, consent] of ledger.consents.entries()) {
    if (consentIds.has(consent.consentId)) {
      issue(["consents", index, "consentId"], "consentId 必须唯一");
    }
    consentIds.add(consent.consentId);
    if (consent.revokedAt !== null && consent.revokedAt < consent.grantedAt) {
      issue(["consents", index, "revokedAt"], "consent revoke 不得早于 grant");
    }
    if (consent.revokedAt === null) {
      const key = `${ownerKey(consent.owner)}\0${consent.workspaceKey}\0${consent.canonicalIdentityDigest}`;
      if (activeConsents.has(key)) {
        issue(["consents", index], "active consent tuple 必须唯一");
      }
      activeConsents.add(key);
    }
  }

  const bindings = new Map<string, z.infer<typeof bindingSchema>>();
  const holdingTargets = new Set<string>();
  const leaseIds = new Set<string>();
  for (const [index, binding] of ledger.bindings.entries()) {
    if (bindings.has(binding.bindingId)) {
      issue(["bindings", index, "bindingId"], "bindingId 必须唯一");
    }
    bindings.set(binding.bindingId, binding);
    const owners = new Set(binding.owners.map(ownerKey));
    if (owners.size !== binding.owners.length) {
      issue(["bindings", index, "owners"], "binding owner 不得重复");
    }
    if (binding.state === "active") {
      if (binding.revokedByOperationId !== null || !binding.owners.length) {
        issue(["bindings", index, "state"], "active binding 必须有 owner 且无 revoke operation");
      }
    } else if (binding.revokedByOperationId === null) {
      issue(["bindings", index, "revokedByOperationId"], "非 active binding 必须绑定 revoke operation");
    }
    if (["revoked", "foreign"].includes(binding.state) &&
      (binding.owners.length || binding.leases.length)) {
      issue(["bindings", index, "state"], "settled binding 不得保留 owner/lease");
    }
    if (["active", "revoke-pending"].includes(binding.state)) {
      const target = `${binding.workspaceKey}\0${binding.projectionId}`;
      if (holdingTargets.has(target)) {
        issue(["bindings", index, "projectionId"], "holding projection target 必须唯一");
      }
      holdingTargets.add(target);
    }
    for (const [leaseIndex, lease] of binding.leases.entries()) {
      if (leaseIds.has(lease.leaseId)) {
        issue(["bindings", index, "leases", leaseIndex, "leaseId"], "leaseId 必须全局唯一");
      }
      leaseIds.add(lease.leaseId);
      const consent = ledger.consents.find((item) =>
        item.consentId === lease.workspaceConsentId
      );
      if (!consent || consent.workspaceKey !== binding.workspaceKey ||
        ownerKey(consent.owner) !== ownerKey(lease.owner)) {
        issue(["bindings", index, "leases", leaseIndex], "lease 必须精确引用 owner/workspace consent");
      }
    }
  }

  const receiptIds = new Set<string>();
  const activeReceipts = new Set<string>();
  for (const [index, receipt] of ledger.sessionDiscoveries.entries()) {
    if (receiptIds.has(receipt.receiptId)) {
      issue(["sessionDiscoveries", index, "receiptId"], "session receiptId 必须唯一");
    }
    receiptIds.add(receipt.receiptId);
    if (receipt.releasedAt !== null && receipt.releasedAt < receipt.acquiredAt) {
      issue(["sessionDiscoveries", index, "releasedAt"], "session release 不得早于 acquire");
    }
    const binding = bindings.get(receipt.bindingId);
    if (!binding || !sameReceiptBinding(receipt, binding)) {
      issue(["sessionDiscoveries", index], "session receipt 必须逐字匹配 projection binding");
      continue;
    }
    if (receipt.revokedByOperationId !== null &&
      receipt.revokedByOperationId !== binding.revokedByOperationId) {
      issue(["sessionDiscoveries", index, "revokedByOperationId"], "session revocation 必须指向 binding operation");
    }
    if (receipt.releasedAt === null) {
      const tuple = `${receipt.conversationId}\0${receipt.backend}\0${receipt.sessionId}\0${receipt.bindingId}`;
      if (activeReceipts.has(tuple)) {
        issue(["sessionDiscoveries", index], "active session receipt tuple 必须唯一");
      }
      activeReceipts.add(tuple);
      if (binding.state !== "active" &&
        receipt.revokedByOperationId !== binding.revokedByOperationId) {
        issue(["sessionDiscoveries", index], "active session holder 必须绑定当前 revoke operation");
      }
    }
  }

  const authorityTokens = new Set<string>();
  for (const [index, authority] of ledger.authorities.entries()) {
    if (authorityTokens.has(authority.authorityToken)) {
      issue(["authorities", index, "authorityToken"], "authority token 必须唯一");
    }
    authorityTokens.add(authority.authorityToken);
    if (authority.consumedAt !== null && authority.consumedAt > authority.expiresAt) {
      issue(["authorities", index, "consumedAt"], "authority 不得在过期后消费");
    }
  }
});

export type ProjectionLedgerState = z.infer<typeof projectionLedgerSchema>;
export type ExtensionProjectionBinding = z.infer<typeof bindingSchema>;
export type ExtensionWorkspaceConsent = z.infer<typeof consentSchema>;
export type ExtensionProjectionLease = z.infer<typeof leaseSchema>;
export type ExtensionBindingAuthority = z.infer<typeof bindingAuthoritySchema>;
export type ProjectionDelivery = z.infer<typeof projectionDeliverySchema>;
export type ProjectionAdmission = z.infer<typeof projectionAdmissionSchema>;

function ownerKey(owner: z.infer<typeof ownerSchema>) {
  return owner.kind === "app" ? `app:${owner.appId}` : "user";
}

function refKey(ref: z.infer<typeof generationRefSchema>) {
  return `${ref.packageGenerationId}\0${ref.recordDigest}`;
}

function sameReceiptBinding(
  receipt: z.infer<typeof sessionDiscoverySchema>,
  binding: z.infer<typeof bindingSchema>
) {
  return receipt.workspaceKey === binding.workspaceKey &&
    receipt.installIdentity === binding.installIdentity &&
    refKey(receipt.packageGenerationRef) === refKey(binding.packageGenerationRef) &&
    receipt.componentInstanceIdentity === binding.componentInstanceIdentity &&
    receipt.backend === binding.delivery.backend &&
    receipt.backendRuntimeIdentity === binding.delivery.runtimeIdentity &&
    receipt.deliveryIdentity === binding.delivery.deliveryIdentity;
}
