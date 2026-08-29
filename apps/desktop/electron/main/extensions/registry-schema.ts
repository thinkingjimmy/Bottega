/**
 * [INPUT]: Depends on zod, canonical ProductResourceScope, and shared Extension digest types
 * [OUTPUT]: Provides the strict schema-v6 scoped Extension registry, durable install reservations, operation-bound lifecycle receipts, empty state, and package/source types
 * [POS]: Persistence cutover boundary for registry-store; pre-release schemas and adapter identities are intentionally unreadable
 */

import { z } from "zod";
import {
  SHA256_DIGEST_IDENTITY_PATTERN,
  type Sha256Digest,
} from "../../../shared/extensions-ipc";

export const EXTENSION_REGISTRY_SCHEMA_VERSION = 6;

const REF_OWNER_PATTERN = /^[A-Za-z0-9:._/-]{1,500}$/;
const digestSchema = z
  .string()
  .regex(SHA256_DIGEST_IDENTITY_PATTERN)
  .transform((value) => value as Sha256Digest);
const identitySchema = z.string().regex(SHA256_DIGEST_IDENTITY_PATTERN);
const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z
    .object({
      kind: z.literal("project"),
      projectId: z.string().regex(/^[A-Za-z0-9_-]{10,64}$/),
    })
    .strict(),
]);
const generationRefSchema = z
  .object({ packageGenerationId: z.string().min(1), recordDigest: digestSchema })
  .strict();
const generationSchema = z
  .object({
    packageGenerationId: z.string().min(1),
    installIdentity: identitySchema,
    contentDigest: digestSchema,
    provenanceDigest: digestSchema,
    admissionEvidence: z
      .object({
        adapterId: z.enum(["agent-plugins-1.0.0", "skill-repo-1.0.0"]),
        schemaDigest: digestSchema,
        validatorFixtureDigest: digestSchema,
        admissionDigest: digestSchema,
      })
      .strict(),
    displayName: z.string().min(1).optional(),
    declaredCapabilityDigest: digestSchema,
    dataBinding: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }).strict(),
      z
        .object({ kind: z.literal("stdio"), pluginDataEpochId: z.string().min(1) })
        .strict(),
    ]),
    recordDigest: digestSchema,
  })
  .strict();
const componentSchema = z
  .object({
    declaredComponentIdentity: z.string().min(1),
    componentInstanceIdentity: identitySchema,
    packageGenerationRef: generationRefSchema,
    componentId: z.string().min(1),
    kind: z.enum(["skill", "mcp-server"]),
    transport: z.enum([
      "manual-snapshot",
      "fixed-workspace",
      "stdio",
      "streamable-http",
      "sse",
    ]),
    declarationDigest: digestSchema,
    declaredConfigDigest: digestSchema,
    serverId: z.string().min(1).optional(),
  })
  .strict();
const sourceSchema = z
  .object({
    normalizedUrl: z.string().min(1),
    requestedRef: z.string(),
    resolvedCommit: z.string().min(1),
    subdirectory: z.string(),
    treeDigest: digestSchema,
    fetchedAt: z.number().int().nonnegative(),
  })
  .strict();
const generationSourceSchema = z
  .object({ packageGenerationId: z.string().min(1), source: sourceSchema })
  .strict();
const packageSchema = z
  .object({
    installIdentity: identitySchema,
    scope: scopeSchema,
    sourceIdentity: identitySchema,
    generationSources: z.array(generationSourceSchema),
    activeGenerationRef: generationRefSchema.nullable(),
    generations: z.array(generationSchema),
    components: z.array(componentSchema),
    admission: z.enum(["valid", "misconfigured"]),
    administrativeState: z.enum(["active", "disable-pending", "denied"]),
    enabled: z.enum(["enabled", "disable-pending", "disabled"]),
    enabledComponentInstanceIdentities: z.array(identitySchema),
    removalPendingGenerationIds: z.array(z.string().min(1)),
  })
  .strict();
const refsSchema = z.record(
  z.string().min(1),
  z.array(z.string().regex(REF_OWNER_PATTERN)).max(100_000)
);
const installReservationSchema = z
  .object({
    operationId: z.string().min(1),
    packageGenerationId: z.string().min(1),
    installIdentity: identitySchema,
    sourceIdentity: identitySchema,
    scope: scopeSchema,
    adapterId: z.enum(["agent-plugins-1.0.0", "skill-repo-1.0.0"]),
    expectedScopeRevision: z.number().int().nonnegative(),
    expectedActiveGenerationRef: generationRefSchema.nullable(),
    activatedGenerationRef: generationRefSchema.nullable(),
    phase: z.enum(["reserved", "activated"]),
  })
  .strict();
const lifecycleReceiptSchema = z.discriminatedUnion("kind", [
  z
    .object({
      operationId: z.string().min(1),
      kind: z.literal("disable"),
      installIdentity: identitySchema,
      sourceIdentity: identitySchema,
      scope: scopeSchema,
      phase: z.enum(["pending", "completed"]),
    })
    .strict(),
  z
    .object({
      operationId: z.string().min(1),
      kind: z.literal("uninstall"),
      installIdentity: identitySchema,
      sourceIdentity: identitySchema,
      scope: scopeSchema,
      packageGenerationRefs: z.array(generationRefSchema),
      removedContentDigests: z.array(digestSchema),
      phase: z.enum(["pending", "removed", "cancelled"]),
    })
    .strict(),
]);

export const extensionRegistryStoreSchema = z
  .object({
    schemaVersion: z.literal(EXTENSION_REGISTRY_SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    scopeRevisions: z.record(z.string().min(1), z.number().int().nonnegative()),
    packages: z.array(packageSchema),
    refs: refsSchema,
    installReservations: z.array(installReservationSchema),
    lifecycleReceipts: z.array(lifecycleReceiptSchema),
  })
  .strict()
  .superRefine((store, context) => {
    const installIdentities = new Set<string>();
    const instanceOwners = new Map<string, string>();
    const generationInstances = new Set<string>();
    const generationIds = new Set<string>();
    const generationRefs = new Set<string>();
    for (const [packageIndex, item] of store.packages.entries()) {
      if (installIdentities.has(item.installIdentity)) {
        context.addIssue({
          code: "custom",
          path: ["packages", packageIndex, "installIdentity"],
          message: "installIdentity 必须全局唯一",
        });
      }
      installIdentities.add(item.installIdentity);
      const scopeKey = item.scope.kind === "global"
        ? "global"
        : `project:${item.scope.projectId}`;
      if (store.scopeRevisions[scopeKey] === undefined) {
        context.addIssue({
          code: "custom",
          path: ["scopeRevisions", scopeKey],
          message: "package scope 缺少 revision tombstone",
        });
      }
      const ownedRefs = new Set<string>();
      const ownedGenerationIds = new Set<string>();
      for (const [generationIndex, generation] of item.generations.entries()) {
        const path = ["packages", packageIndex, "generations", generationIndex];
        if (generation.installIdentity !== item.installIdentity) {
          issue(context, path, "generation installIdentity 必须等于 package owner");
        }
        if (generationIds.has(generation.packageGenerationId)) {
          issue(context, path, "packageGenerationId 必须全局唯一");
        }
        generationIds.add(generation.packageGenerationId);
        ownedGenerationIds.add(generation.packageGenerationId);
        const key = generationRefKey(generation);
        ownedRefs.add(key);
        generationRefs.add(key);
      }
      if (
        item.activeGenerationRef &&
        !ownedRefs.has(generationRefKey(item.activeGenerationRef))
      ) {
        issue(
          context,
          ["packages", packageIndex, "activeGenerationRef"],
          "activeGenerationRef 必须精确指向本 package generation"
        );
      }
      const sourceIds = new Set<string>();
      for (const [sourceIndex, source] of item.generationSources.entries()) {
        const path = ["packages", packageIndex, "generationSources", sourceIndex];
        if (sourceIds.has(source.packageGenerationId)) {
          issue(context, path, "generation source 不得重复");
        }
        sourceIds.add(source.packageGenerationId);
        if (!ownedGenerationIds.has(source.packageGenerationId)) {
          issue(context, path, "generation source 不得悬空或跨 owner");
        }
      }
      if (
        sourceIds.size !== ownedGenerationIds.size ||
        [...ownedGenerationIds].some((id) => !sourceIds.has(id))
      ) {
        issue(
          context,
          ["packages", packageIndex, "generationSources"],
          "generationSources 必须与 generations 一一对应"
        );
      }
      const activeRef = item.activeGenerationRef
        ? generationRefKey(item.activeGenerationRef)
        : null;
      const activeInstances = new Set<string>();
      for (const [componentIndex, component] of item.components.entries()) {
        const componentPath = ["packages", packageIndex, "components", componentIndex];
        const componentRef = generationRefKey(component.packageGenerationRef);
        if (!ownedRefs.has(componentRef)) {
          issue(
            context,
            componentPath,
            "component generation ref 必须精确指向本 package generation"
          );
        }
        if (componentRef === activeRef) {
          activeInstances.add(component.componentInstanceIdentity);
        }
        const owner = instanceOwners.get(component.componentInstanceIdentity);
        if (owner && owner !== item.installIdentity) {
          issue(context, componentPath, "componentInstanceIdentity 不得跨 install owner 复用");
        }
        instanceOwners.set(
          component.componentInstanceIdentity,
          item.installIdentity
        );
        const generationKey = `${component.packageGenerationRef.packageGenerationId}:${component.componentInstanceIdentity}`;
        if (generationInstances.has(generationKey)) {
          issue(context, componentPath, "同一 generation 的 componentInstanceIdentity 必须唯一");
        }
        generationInstances.add(generationKey);
      }
      const enabled = new Set(item.enabledComponentInstanceIdentities);
      if (
        enabled.size !== item.enabledComponentInstanceIdentities.length ||
        [...enabled].some((identity) => !activeInstances.has(identity))
      ) {
        issue(
          context,
          ["packages", packageIndex, "enabledComponentInstanceIdentities"],
          "enabled identities 只能引用 active generation 的本 owner component"
        );
      }
      const removals = new Set(item.removalPendingGenerationIds);
      if (
        removals.size !== item.removalPendingGenerationIds.length ||
        [...removals].some((id) => !ownedGenerationIds.has(id))
      ) {
        issue(
          context,
          ["packages", packageIndex, "removalPendingGenerationIds"],
          "removal-pending identities 只能引用本 owner generation"
        );
      }
    }
    for (const key of Object.keys(store.refs)) {
      if (!generationRefs.has(key)) {
        issue(context, ["refs", key], "generation ref key 不得悬空或 digest 不匹配");
      }
      const owners = store.refs[key] ?? [];
      if (new Set(owners).size !== owners.length) {
        issue(context, ["refs", key], "generation ref owner 必须唯一");
      }
    }
    const reservationOperations = new Set<string>();
    const reservedScopes = new Set<string>();
    for (const [index, reservation] of store.installReservations.entries()) {
      const path = ["installReservations", index];
      const scopeKey = reservation.scope.kind === "global"
        ? "global"
        : `project:${reservation.scope.projectId}`;
      if (reservationOperations.has(reservation.operationId)) {
        issue(context, path, "install reservation operationId 必须唯一");
      }
      reservationOperations.add(reservation.operationId);
      if (reservation.phase === "reserved" && reservedScopes.has(scopeKey)) {
        issue(context, path, "同一 scope 只能有一个 active install reservation");
      }
      if (reservation.phase === "reserved") reservedScopes.add(scopeKey);
      const owner = store.packages.find(
        (item) => item.installIdentity === reservation.installIdentity
      );
      const generation = owner?.generations.find(
        (item) => item.packageGenerationId === reservation.packageGenerationId
      );
      const foreignGeneration = store.packages.some(
        (item) =>
          item.installIdentity !== reservation.installIdentity &&
          item.generations.some(
            (generation) =>
              generation.packageGenerationId === reservation.packageGenerationId
          )
      );
      if (foreignGeneration) {
        issue(context, path, "reserved generation 不得跨 install owner");
      }
      if (owner) {
        const ownerScopeKey = owner.scope.kind === "global"
          ? "global"
          : `project:${owner.scope.projectId}`;
        const ownerBaseline = reservation.phase === "reserved"
          ? owner.activeGenerationRef
          : reservation.expectedActiveGenerationRef;
        const ownerAdapterMatches = owner.generations.every(
          (item) => item.admissionEvidence.adapterId === reservation.adapterId
        );
        if (
          ownerScopeKey !== scopeKey ||
          owner.sourceIdentity !== reservation.sourceIdentity ||
          !ownerAdapterMatches ||
          generationRefKeyOrNull(ownerBaseline) !==
            generationRefKeyOrNull(reservation.expectedActiveGenerationRef)
        ) {
          issue(context, path, "install reservation owner/scope/source/baseline 必须一致");
        }
      } else if (
        reservation.expectedActiveGenerationRef !== null ||
        reservation.phase === "activated"
      ) {
        issue(context, path, "install reservation 缺少 expected owner baseline");
      }
      if (
        reservation.expectedActiveGenerationRef &&
        !owner?.generations.some(
          (item) => generationRefKey(item) ===
            generationRefKey(reservation.expectedActiveGenerationRef!)
        )
      ) {
        issue(context, path, "install reservation update baseline 必须属于 owner");
      }
      if (reservation.activatedGenerationRef) {
        if (
          reservation.phase !== "activated" ||
          !owner ||
          !generation ||
          !owner.activeGenerationRef ||
          generationRefKey(generation) !==
            generationRefKey(reservation.activatedGenerationRef) ||
          generationRefKey(reservation.activatedGenerationRef) !==
            generationRefKey(owner.activeGenerationRef)
        ) {
          issue(context, path, "activated reservation 必须精确绑定 reserved/owner active generation");
        }
      } else if (reservation.phase === "activated") {
        issue(context, path, "activated reservation 缺少 generation ref");
      }
      if (reservation.phase === "reserved" && reservation.activatedGenerationRef) {
        issue(context, path, "reserved install 不得提前携带 activated ref");
      }
    }
    const lifecycleOperations = new Set<string>();
    const activeLifecycleOwners = new Set<string>();
    for (const [index, receipt] of store.lifecycleReceipts.entries()) {
      const path = ["lifecycleReceipts", index];
      if (lifecycleOperations.has(receipt.operationId)) {
        issue(context, path, "lifecycle receipt operationId 必须唯一");
      }
      lifecycleOperations.add(receipt.operationId);
      const owner = store.packages.find(
        (item) => item.installIdentity === receipt.installIdentity
      );
      if (
        owner &&
        (owner.sourceIdentity !== receipt.sourceIdentity ||
          productScopeKey(owner.scope) !== productScopeKey(receipt.scope))
      ) {
        issue(context, path, "lifecycle receipt owner/scope/source 必须一致");
      }
      if (receipt.kind === "disable") {
        if (receipt.phase === "pending") {
          if (activeLifecycleOwners.has(receipt.installIdentity)) {
            issue(context, path, "同一 owner 只能有一个 active lifecycle receipt");
          }
          activeLifecycleOwners.add(receipt.installIdentity);
          if (!owner || owner.administrativeState !== "disable-pending") {
            issue(context, path, "pending disable receipt 必须对应 disable-pending owner");
          }
        } else if (owner && owner.administrativeState === "active") {
          issue(context, path, "completed disable receipt 不得对应 active owner");
        }
        continue;
      }
      const refKeys = receipt.packageGenerationRefs.map(generationRefKey);
      if (new Set(refKeys).size !== refKeys.length) {
        issue(context, path, "uninstall receipt generation refs 必须唯一");
      }
      if (
        new Set(receipt.removedContentDigests).size !==
        receipt.removedContentDigests.length
      ) {
        issue(context, path, "uninstall receipt content digests 必须唯一");
      }
      if (receipt.phase === "pending") {
        if (activeLifecycleOwners.has(receipt.installIdentity)) {
          issue(context, path, "同一 owner 只能有一个 active lifecycle receipt");
        }
        activeLifecycleOwners.add(receipt.installIdentity);
        const ownerRefs = owner?.generations.map(generationRefKey).sort() ?? [];
        if (
          !owner ||
          owner.administrativeState !== "denied" ||
          canonicalStrings(ownerRefs) !== canonicalStrings(refKeys) ||
          canonicalStrings(owner.removalPendingGenerationIds) !==
            canonicalStrings(owner.generations.map((item) => item.packageGenerationId)) ||
          receipt.removedContentDigests.length > 0
        ) {
          issue(context, path, "pending uninstall receipt 必须精确冻结 denied owner generations");
        }
      } else if (receipt.phase === "cancelled") {
        if (
          !owner ||
          owner.administrativeState !== "denied" ||
          owner.removalPendingGenerationIds.length > 0 ||
          receipt.removedContentDigests.length > 0
        ) {
          issue(context, path, "cancelled uninstall receipt 必须对应 reopened denied owner");
        }
      }
    }
  });

export type ExtensionRegistryStoreFile = z.infer<typeof extensionRegistryStoreSchema>;
export type ExtensionRegistryStoredPackage = ExtensionRegistryStoreFile["packages"][number];
export type ExtensionSourceProvenance = z.infer<typeof sourceSchema>;

export function emptyExtensionRegistryStore(): ExtensionRegistryStoreFile {
  return {
    schemaVersion: EXTENSION_REGISTRY_SCHEMA_VERSION,
    revision: 0,
    scopeRevisions: { global: 0 },
    packages: [],
    refs: {},
    installReservations: [],
    lifecycleReceipts: [],
  };
}

function generationRefKey(input: {
  packageGenerationId: string;
  recordDigest: Sha256Digest;
}) {
  return `${input.packageGenerationId}:${input.recordDigest}`;
}

function generationRefKeyOrNull(input: {
  packageGenerationId: string;
  recordDigest: Sha256Digest;
} | null) {
  return input ? generationRefKey(input) : null;
}

function productScopeKey(scope: z.infer<typeof scopeSchema>) {
  return scope.kind === "global" ? "global" : `project:${scope.projectId}`;
}

function canonicalStrings(values: readonly string[]) {
  return [...values].sort().join("\n");
}

function issue(context: z.RefinementCtx, path: (string | number)[], message: string) {
  context.addIssue({ code: "custom", path, message });
}
