/**
 * [INPUT]: Depends on AppRecord's active generation/frozen graph, ExtensionRegistryStore's exact generation ref projection, GrantStore tombstone/exact grants and main-owned capability snapshot
 * [OUTPUT]: Provides projectAppExtensionStatus, a renderer-safe per-generation projection of installed/admission/enabled/grant/eligibility
 * [POS]: The read-only extension projection boundary of apps; a globally active package never stands in for the frozen generation ref and the exact grant
 */

import type {
  AppExtensionRequirementStatus,
  AppExtensionStatus,
  AppRecord,
} from "../../../../shared/apps-ipc";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type {
  AppExtensionRequirementDeclaration,
  ExtensionBackendEligibilityView,
  FrozenAppExtensionRequirement,
  ScopedComponentGrant,
} from "../../../../shared/extensions-ipc";
import type { TurnProjectContext } from "../../../../shared/product-resource-scope";
import { buildExtensionCapabilitySnapshot } from "../../extensions/capability-snapshot";
import {
  backendExtensionProbe,
  EXTENSION_PRODUCT_POLICY,
} from "../../extensions/product-policy";
import type { ExtensionRegistryStore } from "../../extensions/registry-store";
import type { AppExtensionGrantStore } from "../../extensions/integration/grant-store";

const BACKENDS: readonly AgentBackendId[] = [
  "codex",
  "claude",
  "kimi",
  "opencode",
];

export function projectAppExtensionStatus(
  record: AppRecord,
  registry: ExtensionRegistryStore,
  grants: AppExtensionGrantStore,
  projectContext: TurnProjectContext = {
    projectId: null,
    projectLifecycleRevision: null,
  }
): AppExtensionStatus {
  const activeId = record.generationBinding.active?.generationId ?? null;
  const generation = record.generations.find(
    (item) => item.generationId === activeId
  );
  if (!activeId || !generation) {
    return {
      appId: record.id,
      appGenerationId: activeId,
      frozenState: activeId ? "generation-missing" : "none",
      requirements: [],
    };
  }
  if (generation.extensionRequirementResolution.kind !== "frozen") {
    return {
      appId: record.id,
      appGenerationId: activeId,
      frozenState: "none",
      requirements: [],
    };
  }

  /* 四个后端能力快照只为 requirements 服务;没有 requirement 时先探测再丢弃
     纯属白烧一遍 inventory。 */
  const declarations = generation.manifest.extensionRequirements ?? [];
  if (!declarations.length) {
    return {
      appId: record.id,
      appGenerationId: activeId,
      frozenState: "frozen",
      requirements: [],
    };
  }
  const inventory = registry.visibleInventory(projectContext);
  const capability = BACKENDS.map((backendId) =>
    buildExtensionCapabilitySnapshot({
      inventory,
      probe: backendExtensionProbe(
        backendId,
        `${backendId}:app-status-unversioned`,
        "unversioned"
      ),
      policy: EXTENSION_PRODUCT_POLICY,
      deliveryScope: "app",
      selection: "effective",
    })
  );
  const grant = grants.generationProjection(record.id, activeId);
  const frozen = generation.extensionRequirementResolution.frozenSet;
  return {
    appId: record.id,
    appGenerationId: activeId,
    frozenState: "frozen",
    requirements: declarations.map(
      (declaration) => {
        const resolution = frozen.extensionRequirements.find(
          (item) =>
            item.declaredComponentIdentity ===
            declaration.declaredComponentIdentity
        );
        return projectRequirement({
          declaration,
          resolution,
          appGenerationId: activeId,
          grant,
          registry,
          capability,
        });
      }
    ),
  };
}

function projectRequirement(input: {
  declaration: AppExtensionRequirementDeclaration;
  resolution: FrozenAppExtensionRequirement | undefined;
  appGenerationId: string;
  grant: ReturnType<AppExtensionGrantStore["generationProjection"]>;
  registry: ExtensionRegistryStore;
  capability: readonly ReturnType<typeof buildExtensionCapabilitySnapshot>[];
}): AppExtensionRequirementStatus {
  const base = {
    declaredComponentIdentity: input.declaration.declaredComponentIdentity,
    required: input.declaration.required,
    ...(input.declaration.requestedConfig
      ? { requestedConfig: input.declaration.requestedConfig }
      : {}),
  };
  if (input.resolution?.state !== "resolved") {
    return {
      ...base,
      resolution: { state: "unresolved" },
      installed: false,
      admission: "unknown",
      generationState: "unresolved",
      enabled: "unknown",
      grant: { state: "not-applicable" },
      eligibility: [],
    };
  }

  const resolution = input.resolution;
  const generation = input.registry.generationProjection(
    resolution.packageGenerationRef
  );
  const component = generation?.components.find(
    (item) =>
      item.componentInstanceIdentity === resolution.componentInstanceIdentity
  );
  const generationState = !generation
    ? "missing"
    : generation.removalPending
      ? "removal-pending"
      : generation.active
        ? "active"
        : "retained";
  const exactGrant = input.grant.grants.find((item) =>
    matchesGrant(item, resolution, input.appGenerationId)
  );
  return {
    ...base,
    resolution: {
      state: "resolved",
      packageGenerationRef: resolution.packageGenerationRef,
      resolvedConfigDigest: resolution.resolvedConfigDigest,
    },
    componentInstanceIdentity: resolution.componentInstanceIdentity,
    installed: Boolean(generation && component),
    admission: generation?.admission ?? "unknown",
    generationState,
    enabled: enabledState(
      generationState,
      generation,
      component?.componentInstanceIdentity
    ),
    grant: input.grant.revokedAt
      ? { state: "revoked", revokedAt: input.grant.revokedAt }
      : exactGrant
        ? { state: "granted", revision: exactGrant.grantRevision }
        : { state: "missing" },
    eligibility:
      generationState === "active" && component
        ? input.capability.map((snapshot) =>
            eligibilityOf(snapshot, component.componentInstanceIdentity)
          )
        : [],
  };
}

function enabledState(
  state: AppExtensionRequirementStatus["generationState"],
  generation: ReturnType<ExtensionRegistryStore["generationProjection"]>,
  componentInstanceIdentity: string | undefined
): AppExtensionRequirementStatus["enabled"] {
  if (!generation || !componentInstanceIdentity) return "unknown";
  if (state === "removal-pending") return "removal-pending";
  if (state === "retained") return "retained";
  if (generation.administrativeState === "disable-pending") {
    return "disable-pending";
  }
  return generation.administrativeState === "active" ? "yes" : "no";
}

function matchesGrant(
  grant: ScopedComponentGrant,
  resolution: Extract<FrozenAppExtensionRequirement, { state: "resolved" }>,
  appGenerationId: string
) {
  return (
    grant.appGenerationId === appGenerationId &&
    grant.componentInstanceIdentity === resolution.componentInstanceIdentity &&
    grant.declarationDigest === resolution.declarationDigest &&
    grant.resolvedConfigDigest === resolution.resolvedConfigDigest &&
    grant.packageGenerationRef.packageGenerationId ===
      resolution.packageGenerationRef.packageGenerationId &&
    grant.packageGenerationRef.recordDigest ===
      resolution.packageGenerationRef.recordDigest
  );
}

function eligibilityOf(
  snapshot: ReturnType<typeof buildExtensionCapabilitySnapshot>,
  componentInstanceIdentity: string
): ExtensionBackendEligibilityView {
  const entry = snapshot.entries.find(
    (item) => item.componentInstanceIdentity === componentInstanceIdentity
  );
  if (!entry) {
    throw new Error(
      `active Extension component 缺少能力投影：${componentInstanceIdentity}`
    );
  }
  return {
    backendId: snapshot.backendId,
    channel: entry.transport,
    eligible: entry.eligible,
    strength: entry.deliveryStrength,
    ...(entry.exclusion ? { exclusionCode: entry.exclusion.code } : {}),
  };
}
