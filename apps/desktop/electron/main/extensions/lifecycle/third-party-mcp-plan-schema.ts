/**
 * [INPUT]: Depends on zod plus shared Extension digest, generation-ref, and backend identity contracts
 * [OUTPUT]: Provides the v3 ThirdPartyMcpPlan durable schema, settled-v1 migration, inferred entry/binding types, and exact-ref helpers
 * [POS]: Persistence integrity and version-cutover authority for the per-turn App delivery plan ledger; the runtime ledger owns transitions
 */

import { z } from "zod";
import {
  SHA256_DIGEST_IDENTITY_PATTERN,
  type ExtensionPackageGenerationRef,
  type Sha256Digest,
} from "../../../../shared/extensions-ipc";

export const planDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
  .transform((value) => value as Sha256Digest);
const identity = z.string().regex(SHA256_DIGEST_IDENTITY_PATTERN);
const refSchema = z.object({
  packageGenerationId: z.string().min(1), recordDigest: planDigestSchema,
}).strict();
const projectContextSchema = z.union([
  z.object({ projectId: z.null(), projectLifecycleRevision: z.null() }).strict(),
  z.object({
    projectId: z.string().min(1),
    projectLifecycleRevision: z.number().int().positive(),
  }).strict(),
]);
export const planBindingSchema = z.object({
  deliveryInstanceId: z.string().min(1),
  sourceIdentity: identity,
  generationRef: refSchema,
  backend: z.enum(["codex", "claude", "kimi", "opencode"]),
  backendRuntimeIdentity: z.string().min(1),
  deliveryIdentity: planDigestSchema,
  componentPlanLeaseId: z.string().min(1),
  resolvedConfigDigest: planDigestSchema,
}).strict();
export const planSessionHandoffSchema = z.object({
  receiptId: z.string().uuid(),
  conversationId: z.string().min(1),
  backend: z.enum(["codex", "claude", "kimi", "opencode"]),
  backendRuntimeIdentity: z.string().min(1),
  sessionId: z.string().min(1),
  deliveryInstanceId: z.string().min(1),
  generationRef: refSchema,
  componentInstanceIdentity: identity,
  deliveryIdentity: planDigestSchema,
  acquiredAt: z.number().int().nonnegative(),
  releasedAt: z.number().int().nonnegative().nullable(),
  revokedByOperationId: z.string().min(1).nullable(),
}).strict();
const sessionRevocationSchema = z.object({
  operationId: z.string().min(1),
  componentInstanceIdentities: z.array(identity),
  begunAt: z.number().int().nonnegative(),
}).strict();
export const thirdPartyMcpPlanEntrySchema = z.object({
  requestId: z.string().min(1),
  planInstanceId: z.string().min(1),
  owner: z.string().regex(/^plan:[A-Za-z0-9._:-]+$/),
  componentPlanLeaseIds: z.array(z.string().min(1)),
  bindings: z.array(planBindingSchema),
  sourcePlanDigest: planDigestSchema,
  projectContext: projectContextSchema,
  executionPlanDigest: planDigestSchema.nullable(),
  resolvedMcpDeliveryInstanceIds: z.array(z.string().min(1)),
  materializedDeliveryInstanceIds: z.array(z.string().min(1)),
  sessionHandoffs: z.array(planSessionHandoffSchema),
  sessionRevocations: z.array(sessionRevocationSchema),
  requestReleasedAt: z.number().int().nonnegative().nullable(),
  retainedGenerationRefs: z.array(refSchema),
  phase: z.enum(["preparing", "active", "release-pending", "session-held", "released"]),
  revision: z.number().int().nonnegative(),
}).strict();

export const thirdPartyMcpPlanFileSchema = z.object({
  schemaVersion: z.literal(3),
  revision: z.number().int().nonnegative(),
  entries: z.array(thirdPartyMcpPlanEntrySchema),
}).strict().superRefine((file, context) => {
  const requestIds = new Set<string>();
  const planIds = new Set<string>();
  const owners = new Set<string>();
  const issue = (path: (string | number)[], message: string) =>
    context.addIssue({ code: "custom", path, message });
  for (const [index, entry] of file.entries.entries()) {
    validateEntry(entry, index, { requestIds, planIds, owners, issue });
  }
});

const legacyPlanBindingSchema = z.object({
  deliveryInstanceId: z.string().min(1),
  sourceIdentity: z.string().min(1),
  generationRef: refSchema,
  componentPlanLeaseId: z.string().min(1),
  resolvedConfigDigest: planDigestSchema,
}).strict();
const legacyPlanEntrySchema = z.object({
  requestId: z.string().min(1),
  planInstanceId: z.string().min(1),
  owner: z.string().regex(/^plan:[A-Za-z0-9._:-]+$/),
  componentPlanLeaseIds: z.array(z.string().min(1)),
  bindings: z.array(legacyPlanBindingSchema),
  sourcePlanDigest: planDigestSchema,
  executionPlanDigest: planDigestSchema.nullable(),
  resolvedMcpDeliveryInstanceIds: z.array(z.string().min(1)),
  phase: z.enum(["preparing", "active", "release-pending", "released"]),
  revision: z.number().int().nonnegative(),
}).strict();
const legacyPlanFileSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  entries: z.array(legacyPlanEntrySchema),
}).strict();

export type ThirdPartyMcpPlanFile = z.infer<typeof thirdPartyMcpPlanFileSchema>;
export type ThirdPartyMcpPlanEntry = ThirdPartyMcpPlanFile["entries"][number];
export type ThirdPartyMcpPlanBinding = z.infer<typeof planBindingSchema>;

/**
 * v1 cannot prove the backend/session identities required by v3. Only terminal
 * rows are safe to compact; any live legacy custody remains fail-closed.
 */
export function upgradeThirdPartyMcpPlanFile(
  raw: unknown
): ThirdPartyMcpPlanFile | undefined {
  const legacy = legacyPlanFileSchema.safeParse(raw);
  if (!legacy.success || legacy.data.entries.some((entry) => entry.phase !== "released")) {
    return undefined;
  }
  return {
    schemaVersion: 3,
    revision: legacy.data.revision + 1,
    entries: [],
  };
}

type ValidationAuthority = {
  requestIds: Set<string>;
  planIds: Set<string>;
  owners: Set<string>;
  issue(path: (string | number)[], message: string): void;
};

function validateEntry(
  entry: ThirdPartyMcpPlanEntry,
  index: number,
  authority: ValidationAuthority
) {
  const root = ["entries", index];
  for (const [value, seen, label] of [
    [entry.requestId, authority.requestIds, "requestId"],
    [entry.planInstanceId, authority.planIds, "planInstanceId"],
    [entry.owner, authority.owners, "owner"],
  ] as const) {
    if (seen.has(value)) authority.issue([...root, label], `${label} 必须全局唯一`);
    seen.add(value);
  }
  if (entry.owner !== `plan:${entry.planInstanceId}`) {
    authority.issue([...root, "owner"], "owner 必须由 planInstanceId 唯一派生");
  }
  const bindings = new Map(entry.bindings.map((item) => [item.deliveryInstanceId, item]));
  if (bindings.size !== entry.bindings.length) {
    authority.issue([...root, "bindings"], "binding deliveryInstanceId 必须唯一");
  }
  validateBindingSets(entry, bindings, root, authority.issue);
  validateSessionReceipts(entry, bindings, root, authority.issue);
  validateRevocations(entry, root, authority.issue);
  validatePhase(entry, root, authority.issue);
}

function validateBindingSets(
  entry: ThirdPartyMcpPlanEntry,
  bindings: ReadonlyMap<string, ThirdPartyMcpPlanBinding>,
  root: (string | number)[],
  issue: ValidationAuthority["issue"]
) {
  const bindingLeases = new Set(entry.bindings.map((item) => item.componentPlanLeaseId));
  const declaredLeases = new Set(entry.componentPlanLeaseIds);
  if (
    bindingLeases.size !== entry.bindings.length ||
    declaredLeases.size !== entry.componentPlanLeaseIds.length ||
    !sameSet(bindingLeases, declaredLeases)
  ) {
    issue([...root, "componentPlanLeaseIds"], "component plan lease 必须与 binding 一一对应");
  }
  for (const [field, values] of [
    ["resolvedMcpDeliveryInstanceIds", entry.resolvedMcpDeliveryInstanceIds],
    ["materializedDeliveryInstanceIds", entry.materializedDeliveryInstanceIds],
  ] as const) {
    if (new Set(values).size !== values.length || values.some((value) => !bindings.has(value))) {
      issue([...root, field], `${field} 必须是唯一 binding 子集`);
    }
  }
}

function validateSessionReceipts(
  entry: ThirdPartyMcpPlanEntry,
  bindings: ReadonlyMap<string, ThirdPartyMcpPlanBinding>,
  root: (string | number)[],
  issue: ValidationAuthority["issue"]
) {
  const activeTuples = new Set<string>();
  for (const [index, receipt] of entry.sessionHandoffs.entries()) {
    const binding = bindings.get(receipt.deliveryInstanceId);
    if (
      !binding || binding.sourceIdentity !== receipt.componentInstanceIdentity ||
      refKey(binding.generationRef) !== refKey(receipt.generationRef) ||
      binding.backend !== receipt.backend ||
      binding.backendRuntimeIdentity !== receipt.backendRuntimeIdentity ||
      binding.deliveryIdentity !== receipt.deliveryIdentity ||
      !entry.materializedDeliveryInstanceIds.includes(receipt.deliveryInstanceId)
    ) {
      issue([...root, "sessionHandoffs", index], "session handoff 必须逐字匹配已物化 binding");
    }
    if (receipt.releasedAt !== null) continue;
    const tuple = `${receipt.conversationId}\0${receipt.backend}\0${receipt.sessionId}\0${receipt.deliveryInstanceId}`;
    if (activeTuples.has(tuple)) {
      issue([...root, "sessionHandoffs", index], "active session tuple 重复");
    }
    activeTuples.add(tuple);
  }
}

function validateRevocations(
  entry: ThirdPartyMcpPlanEntry,
  root: (string | number)[],
  issue: ValidationAuthority["issue"]
) {
  const components = new Set(entry.bindings.map((item) => item.sourceIdentity));
  const operations = new Set<string>();
  for (const [index, revocation] of entry.sessionRevocations.entries()) {
    const unique = new Set(revocation.componentInstanceIdentities);
    if (operations.has(revocation.operationId)) {
      issue([...root, "sessionRevocations", index], "revocation operation 重复");
    }
    operations.add(revocation.operationId);
    if (
      unique.size !== revocation.componentInstanceIdentities.length ||
      revocation.componentInstanceIdentities.some((item) => !components.has(item))
    ) {
      issue([...root, "sessionRevocations", index], "revocation component 必须是唯一 binding 子集");
    }
  }
}

function validatePhase(
  entry: ThirdPartyMcpPlanEntry,
  root: (string | number)[],
  issue: ValidationAuthority["issue"]
) {
  const bindingRefs = new Set(entry.bindings.map((item) => refKey(item.generationRef)));
  const retainedRefs = new Set(entry.retainedGenerationRefs.map(refKey));
  const activeRefs = new Set(activePlanSessionRefs(entry).map(refKey));
  if (
    retainedRefs.size !== entry.retainedGenerationRefs.length ||
    [...retainedRefs].some((item) => !bindingRefs.has(item))
  ) {
    issue([...root, "retainedGenerationRefs"], "retained ref 必须是唯一 binding 子集");
  }
  if (["preparing", "active"].includes(entry.phase)) {
    if (entry.requestReleasedAt !== null || retainedRefs.size) {
      issue(root, "active request 不得携带 release/retained 状态");
    }
    return;
  }
  if (["session-held", "release-pending"].includes(entry.phase)) {
    if (
      entry.requestReleasedAt === null ||
      (entry.phase === "session-held" && !activeRefs.size) ||
      !sameSet(retainedRefs, activeRefs)
    ) {
      issue(root, `${entry.phase} 必须精确保留 active handoff refs`);
    }
    return;
  }
  if (entry.requestReleasedAt === null || retainedRefs.size || activeRefs.size) {
    issue(root, "released plan 必须已释放 request/generation/session holder");
  }
}

export function activePlanSessionRefs(
  entry: ThirdPartyMcpPlanEntry
): ExtensionPackageGenerationRef[] {
  const refs = new Map<string, ExtensionPackageGenerationRef>();
  for (const receipt of entry.sessionHandoffs) {
    if (receipt.releasedAt === null) refs.set(refKey(receipt.generationRef), receipt.generationRef);
  }
  return [...refs.values()];
}

export const planGenerationRefKey = (ref: ExtensionPackageGenerationRef) => refKey(ref);

function refKey(ref: ExtensionPackageGenerationRef) {
  return `${ref.packageGenerationId}\0${ref.recordDigest}`;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every((item) => right.has(item));
}
