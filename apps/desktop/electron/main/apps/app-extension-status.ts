/**
 * [INPUT]: Depends on AppRecord's active generation/frozen graph, ExtensionRegistryStore's exact generation ref projection, GrantStore tombstone/exact grants and main-owned capability snapshot
 * [OUTPUT]: Provides projectAppExtensionStatus, renderer-safe projection of installed/admission/enabled/grant/eligibility/health by app generation
 * [POS]: AppxExtension of apps only read the projection boundaries; The global active package of snapshots is not a substitute for frozen generation ref and exact grant
 */

import type {
  AppExtensionRequirementStatus,
  AppExtensionStatus,
  AppRecord,
} from "../../../shared/apps-ipc";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import type {
  AppExtensionRequirementDeclaration,
  ExtensionBackendEligibilityView,
  FrozenAppExtensionRequirement,
  ScopedComponentGrant,
} from "../../../shared/extensions-ipc";
import { buildExtensionCapabilitySnapshot } from "../extensions/capability-snapshot";
import {
  backendExtensionProbe,
  EXTENSION_PRODUCT_POLICY,
} from "../extensions/product-policy";
import type { ExtensionRegistryStore } from "../extensions/registry-store";
import type { AppExtensionGrantStore } from "../extensions/integration/grant-store";

const BACKENDS: readonly AgentBackendId[] = [
  "codex",
  "claude",
  "kimi",
  "opencode",
];

export function projectAppExtensionStatus(
  record: AppRecord,
  registry: ExtensionRegistryStore,
  grants: AppExtensionGrantStore
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

  const inventory = registry.snapshot();
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
    })
  );
  const grant = grants.generationProjection(record.id, activeId);
  const frozen = generation.extensionRequirementResolution.frozenSet;
  return {
    appId: record.id,
    appGenerationId: activeId,
    frozenState: "frozen",
    requirements: (generation.manifest.extensionRequirements ?? []).map(
      (declaration) => {
        const resolution = frozen.extensionRequirements.find(
          (item) => item.componentIdentity === declaration.componentIdentity
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
    componentIdentity: input.declaration.componentIdentity,
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
      deliveryHealth: [],
    };
  }

  const resolution = input.resolution;
  const generation = input.registry.generationProjection(
    resolution.packageGenerationRef
  );
  const component = generation?.components.find(
    (item) => item.componentIdentity === resolution.componentIdentity
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
    installed: Boolean(generation && component),
    admission: generation?.admission ?? "unknown",
    generationState,
    enabled: enabledState(generationState, generation, component?.componentIdentity),
    grant: input.grant.revokedAt
      ? { state: "revoked", revokedAt: input.grant.revokedAt }
      : exactGrant
        ? { state: "granted", revision: exactGrant.grantRevision }
        : { state: "missing" },
    eligibility:
      generationState === "active" && component
        ? input.capability.map((snapshot) =>
            eligibilityOf(snapshot, component.componentIdentity)
          )
        : [],
    deliveryHealth:
      generationState === "active" && component
        ? BACKENDS.map((backendId) => ({
            backendId,
            channel: component.transport,
            status: "unknown" as const,
          }))
        : [],
  };
}

function enabledState(
  state: AppExtensionRequirementStatus["generationState"],
  generation: ReturnType<ExtensionRegistryStore["generationProjection"]>,
  componentIdentity: string | undefined
): AppExtensionRequirementStatus["enabled"] {
  if (!generation || !componentIdentity) return "unknown";
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
    grant.componentIdentity === resolution.componentIdentity &&
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
  componentIdentity: string
): ExtensionBackendEligibilityView {
  const entry = snapshot.entries.find(
    (item) => item.componentIdentity === componentIdentity
  );
  if (!entry) {
    throw new Error(`active Extension component 缺少能力投影：${componentIdentity}`);
  }
  return {
    backendId: snapshot.backendId,
    channel: entry.transport,
    eligible: entry.eligible,
    strength: entry.deliveryStrength,
    ...(entry.exclusion ? { exclusionCode: entry.exclusion.code } : {}),
  };
}
