/**
 * [INPUT]: Depends on App extensionRequirements, authoritative inventory and component-owned config resolver
 * [OUTPUT]: Provides freezeAppExtensionRequirements, generating complete resolved/unresolved graphs and canonical digests
 * [POS]: The generation seal of the AppXExtension; Old generation never re-parsled with live Registry
 */

import { randomUUID } from "node:crypto";
import type {
  AppExtensionRequirementDeclaration,
  ExtensionComponentRecord,
  ExtensionInventorySnapshot,
  FrozenAppExtensionRequirement,
  FrozenAppExtensionRequirementSetV1,
  FrozenExtensionInventoryReason,
  Sha256Digest,
} from "../../../../shared/extensions-ipc";
import { digestCanonical } from "../registry-store";

export type ComponentConfigResolver = (input: {
  component: ExtensionComponentRecord;
  requestedConfig: Record<string, unknown> | undefined;
}) => { resolvedConfigDigest: Sha256Digest; capabilitySetDigest: Sha256Digest };

export function freezeAppExtensionRequirements(input: {
  appGenerationId: string;
  declarations: readonly AppExtensionRequirementDeclaration[];
  inventory: ExtensionInventorySnapshot;
  resolveConfig?: ComponentConfigResolver;
}): FrozenAppExtensionRequirementSetV1 {
  assertUnique(input.declarations);
  const resolveConfig = input.resolveConfig ?? defaultConfigResolver;
  const extensionRequirements = input.declarations.map(
    (declaration): FrozenAppExtensionRequirement => {
      const declarationDigest = digestCanonical(declaration);
      const matches = input.inventory.components.filter(
        (component) => component.componentIdentity === declaration.componentIdentity
      );
      if (matches.length !== 1) {
        return unresolved(
          declaration,
          declarationDigest,
          matches.length ? "identity-conflict" : "component-not-found",
          { matches: String(matches.length) }
        );
      }
      const component = matches[0]!;
      const owner = input.inventory.packages.find((item) =>
        item.generations.some(
          (generation) =>
            generation.packageGenerationId ===
              component.packageGenerationRef.packageGenerationId &&
            generation.recordDigest === component.packageGenerationRef.recordDigest
        )
      );
      const generation = owner?.generations.find(
        (item) => item.packageGenerationId === component.packageGenerationRef.packageGenerationId
      );
      if (!owner || !generation || owner.admission !== "valid") {
        return unresolved(declaration, declarationDigest, "generation-not-admitted", {});
      }
      /* 卸载已关闸的代对**新** resolution 就是不存在。迁移正是在这份 authoritative
         snapshot 上重新冻结的：required 落到 blocked、optional 落到 degraded，
         而不是把旧的 frozen graph 原地改写——旧代仍然精确服务旧 App generation。 */
      if (
        owner.removalPendingGenerationIds.includes(
          component.packageGenerationRef.packageGenerationId
        )
      ) {
        return unresolved(
          declaration,
          declarationDigest,
          "generation-removal-pending",
          { packageGenerationId: component.packageGenerationRef.packageGenerationId }
        );
      }
      if (
        declaration.packageDigest &&
        declaration.packageDigest !== generation.contentDigest
      ) {
        return unresolved(declaration, declarationDigest, "no-matching-generation", {
          packageDigest: declaration.packageDigest,
        });
      }
      if (declaration.versionRange) {
        return unresolved(declaration, declarationDigest, "invalid-app-config", {
          field: "versionRange",
          reason: "registry generation contract has no mutable version alias",
        });
      }
      try {
        const config = resolveConfig({
          component,
          requestedConfig: declaration.requestedConfig,
        });
        return {
          state: "resolved",
          componentIdentity: declaration.componentIdentity,
          packageGenerationRef: component.packageGenerationRef,
          required: declaration.required,
          declarationDigest,
          ...config,
        };
      } catch (cause) {
        return unresolved(declaration, declarationDigest, "invalid-app-config", {
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  );
  const graphDigest = digestCanonical(extensionRequirements);
  const status: FrozenAppExtensionRequirementSetV1["status"] = extensionRequirements.some(
    (entry) => entry.state === "unresolved" && entry.required
  )
    ? "blocked"
    : extensionRequirements.some((entry) => entry.state === "unresolved")
      ? "degraded"
      : "ready";
  const base = {
    resolutionId: randomUUID(),
    appGenerationId: input.appGenerationId,
    registryRevision: input.inventory.revision,
    inventorySnapshotDigest: input.inventory.digest,
    graphDigest,
    status,
    extensionRequirements,
  };
  return { ...base, resolutionDigest: digestCanonical(base) };
}

function defaultConfigResolver(input: {
  component: ExtensionComponentRecord;
  requestedConfig: Record<string, unknown> | undefined;
}) {
  if (input.requestedConfig && Object.keys(input.requestedConfig).length) {
    throw new Error("component 未注册 closed App config override schema");
  }
  return {
    resolvedConfigDigest: input.component.declaredConfigDigest,
    capabilitySetDigest: digestCanonical({
      declarationDigest: input.component.declarationDigest,
      transport: input.component.transport,
    }),
  };
}

function unresolved(
  declaration: AppExtensionRequirementDeclaration,
  declarationDigest: Sha256Digest,
  code: FrozenExtensionInventoryReason["code"],
  parameters: Record<string, string>
): FrozenAppExtensionRequirement {
  const reason: FrozenExtensionInventoryReason = {
    taxonomyVersion: 1,
    code,
    parameters: { componentIdentity: declaration.componentIdentity, ...parameters },
    evidenceDigest: digestCanonical({ code, parameters, declarationDigest }),
  };
  return {
    state: "unresolved",
    componentIdentity: declaration.componentIdentity,
    required: declaration.required,
    declarationDigest,
    reason,
  };
}

function assertUnique(declarations: readonly AppExtensionRequirementDeclaration[]) {
  const seen = new Set<string>();
  for (const declaration of declarations) {
    if (seen.has(declaration.componentIdentity)) {
      throw new Error(`App extension requirement 重复：${declaration.componentIdentity}`);
    }
    seen.add(declaration.componentIdentity);
  }
}
