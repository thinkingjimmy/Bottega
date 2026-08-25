/**
 * [INPUT]: Depends on shared authoritative inventory (health as generation/component/declared-config attribution) ✓ backend/runtime identity and obvious product policy/probe
 * [OUTPUT]: Provides buildExtensionCapabilitySnapshot with entry-by-entry closed eligibility/reason; App/global: two-channel shared management security denied, only global consumer directories preferred
 * [POS]: The three-axis delivery eligibility of extensions; The ability to snapshot driven planner/UI/badge without reversing package admission
 */

import { randomUUID } from "node:crypto";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import type {
  ExtensionCapabilityEntry,
  ExtensionCapabilitySnapshot,
  ExtensionComponentRecord,
  ExtensionDeliveryReference,
  ExtensionInventoryPackage,
  ExtensionInventorySnapshot,
  FrozenExtensionDeliveryEligibilityReason,
  McpComponentHealthRecord,
  Sha256Digest,
} from "../../../shared/extensions-ipc";
import { digestCanonical } from "./registry-store";

export type ExtensionBackendProbe = Readonly<{
  backendId: AgentBackendId;
  backendRuntimeIdentity: string;
  runtimeVersion: string;
  manualSkillSnapshot: boolean;
  fixedWorkspaceProjection: boolean;
  remoteMcp: Readonly<{
    streamableHttp: boolean;
    sse: boolean;
    enforcement:
      | Readonly<{ status: "unverified" }>
      | Readonly<{
          status: "verified";
          mode: "product-proxy" | "backend-native";
          fixtureRevision: string;
          evidenceDigest: Sha256Digest;
        }>;
  }>;
  stdioMcp: Readonly<{
    inclusion: boolean;
    writableRootFence: boolean;
    processCustody: boolean;
  }>;
  multiInstanceIsolation: boolean;
}>;

export type ExtensionProductPolicy = Readonly<{
  revision: string;
  allowFixedWorkspaceProjection: boolean;
  allowRemoteMcp: boolean;
  allowStdioMcp: boolean;
  openCodeExternalSkills: boolean;
}>;

export function buildExtensionCapabilitySnapshot(input: {
  inventory: ExtensionInventorySnapshot;
  probe: ExtensionBackendProbe;
  policy: ExtensionProductPolicy;
  now?: number;
  deliveryScope?: "global-catalog" | "app";
}): ExtensionCapabilitySnapshot {
  const snapshotId = randomUUID();
  const entries = input.inventory.components.map((component) =>
    capabilityEntry(
      snapshotId,
      component,
      input.inventory.packages,
      input.probe,
      input.policy,
      input.inventory.health ?? [],
      input.deliveryScope ?? "global-catalog"
    )
  );
  const base = {
    snapshotId,
    inventoryRevision: input.inventory.revision,
    backendId: input.probe.backendId,
    backendRuntimeIdentity: input.probe.backendRuntimeIdentity,
    productPolicyRevision: input.policy.revision,
    createdAt: input.now ?? Date.now(),
    entries,
  };
  return { ...base, snapshotDigest: digestCanonical(base) };
}

function capabilityEntry(
  snapshotId: string,
  component: ExtensionComponentRecord,
  packages: readonly ExtensionInventoryPackage[],
  probe: ExtensionBackendProbe,
  policy: ExtensionProductPolicy,
  healthRecords: readonly McpComponentHealthRecord[],
  deliveryScope: "global-catalog" | "app"
): ExtensionCapabilityEntry {
  const owner = packages.find((item) =>
    item.generations.some(
      (generation) =>
        generation.packageGenerationId ===
          component.packageGenerationRef.packageGenerationId &&
        generation.recordDigest === component.packageGenerationRef.recordDigest
    )
  );
  const health = healthFor(component, healthRecords, probe);
  const exclusion = exclusionFor(component, owner, probe, policy, health, deliveryScope);
  const deliveryStrength = strengthFor(component, probe, policy);
  const base = {
    componentIdentity: component.componentIdentity,
    packageGenerationRef: component.packageGenerationRef,
    backendId: probe.backendId,
    backendRuntimeIdentity: probe.backendRuntimeIdentity,
    transport: component.transport,
    deliveryStrength,
    eligible: !exclusion,
    multiInstanceIsolation: probe.multiInstanceIsolation,
    ...(health ? { health } : {}),
  };
  if (exclusion) return { ...base, exclusion };
  const referenceBase = {
    capabilitySnapshotId: snapshotId,
    deliveryChannel: component.transport,
    strength: deliveryStrength,
    sharingPolicy: "share-identical" as const,
  };
  const deliveryReference: ExtensionDeliveryReference = {
    ...referenceBase,
    entryDigest: digestCanonical({ component, probe, policy, referenceBase }),
  };
  return { ...base, deliveryReference };
}

function exclusionFor(
  component: ExtensionComponentRecord,
  owner: ExtensionInventoryPackage | undefined,
  probe: ExtensionBackendProbe,
  policy: ExtensionProductPolicy,
  health: McpComponentHealthRecord | undefined,
  deliveryScope: "global-catalog" | "app"
): FrozenExtensionDeliveryEligibilityReason | undefined {
  if (!owner || owner.admission !== "valid") {
    return reason("backend-capability-mismatch", { component: component.componentIdentity });
  }
  if (health?.state === "degraded" || health?.state === "quarantined") {
    return reason("runtime-health-failed", {
      component: component.componentIdentity,
      health: health.state,
      evidenceDigest: health.evidenceDigest,
    });
  }
  if (owner.removalPendingGenerationIds.includes(component.packageGenerationRef.packageGenerationId)) {
    return reason("package-generation-removal-pending", {
      packageGenerationId: component.packageGenerationRef.packageGenerationId,
    });
  }
  if (owner.administrativeState === "disable-pending") {
    return reason("package-disable-pending", { installIdentity: owner.installIdentity });
  }
  if (owner.administrativeState !== "active") {
    return reason("package-disabled", { installIdentity: owner.installIdentity });
  }
  if (
    deliveryScope === "global-catalog" &&
    (!owner.globalCatalogEnabled ||
      !owner.enabledComponentIdentities.includes(component.componentIdentity))
  ) {
    return reason("component-disabled", { component: component.componentIdentity });
  }
  if (component.kind === "skill") {
    if (
      probe.backendId === "opencode" &&
      (!policy.openCodeExternalSkills || component.transport !== "manual-snapshot")
    ) {
      return reason("turn-policy-ineligible", { policy: "opencode-external-skills" });
    }
    if (component.transport === "manual-snapshot" && !probe.manualSkillSnapshot) {
      return reason("delivery-channel-unsupported", { channel: component.transport });
    }
    if (
      component.transport === "fixed-workspace" &&
      (!probe.fixedWorkspaceProjection || !policy.allowFixedWorkspaceProjection)
    ) {
      return reason("projection-unavailable", { channel: component.transport });
    }
    return undefined;
  }
  if (component.transport === "streamable-http" || component.transport === "sse") {
    const supported =
      component.transport === "streamable-http"
        ? probe.remoteMcp.streamableHttp
        : probe.remoteMcp.sse;
    if (
      !policy.allowRemoteMcp ||
      !supported ||
      probe.remoteMcp.enforcement.status !== "verified"
    ) {
      return reason("transport-unsupported", { transport: component.transport });
    }
    return undefined;
  }
  if (
    component.transport === "stdio" &&
    (!policy.allowStdioMcp ||
      !probe.stdioMcp.inclusion ||
      !probe.stdioMcp.writableRootFence ||
      !probe.stdioMcp.processCustody)
  ) {
    return reason("transport-unsupported", { transport: "stdio" });
  }
  return undefined;
}

function healthFor(
  component: ExtensionComponentRecord,
  records: readonly McpComponentHealthRecord[],
  probe: ExtensionBackendProbe
) {
  if (component.kind !== "mcp-server" || !component.serverId) return undefined;
  return records.find((record) => {
    const subject = record.subject;
    return subject.kind === "package" &&
      subject.backend === probe.backendId &&
      subject.runtimeVersion === probe.runtimeVersion &&
      subject.componentId === component.componentId &&
      subject.serverId === component.serverId &&
      subject.declaredConfigDigest === component.declaredConfigDigest &&
      subject.transport === component.transport &&
      subject.generationRef.packageGenerationId ===
        component.packageGenerationRef.packageGenerationId &&
      subject.generationRef.recordDigest === component.packageGenerationRef.recordDigest;
  });
}

function strengthFor(
  component: ExtensionComponentRecord,
  probe: ExtensionBackendProbe,
  policy: ExtensionProductPolicy
) {
  if (component.kind === "skill" && component.transport === "manual-snapshot") {
    return "per-turn-enforced" as const;
  }
  if (component.kind === "skill" && component.transport === "fixed-workspace") {
    return policy.allowFixedWorkspaceProjection && probe.fixedWorkspaceProjection
      ? ("workspace-requested" as const)
      : ("unknown" as const);
  }
  return "server-inclusion-only" as const;
}

function reason(
  code: FrozenExtensionDeliveryEligibilityReason["code"],
  parameters: Record<string, string>
): FrozenExtensionDeliveryEligibilityReason {
  return {
    taxonomyVersion: 1,
    code,
    parameters,
    evidenceDigest: digestCanonical({ code, parameters }),
  };
}
