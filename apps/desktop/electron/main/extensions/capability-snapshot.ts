/**
 * [INPUT]: Depends on shared authoritative inventory (health as generation/component/declared-config attribution) ✓ backend/runtime identity and obvious product policy/probe
 * [OUTPUT]: Provides diagnostic capability snapshots, D13 effective owner selection after backend eligibility is known, and an exact inventory projection for frozen consumers
 * [POS]: The three-axis delivery eligibility authority; planners use effective selection while Settings keeps diagnostic exclusions
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
  selection?: "diagnostic" | "effective";
}): ExtensionCapabilitySnapshot {
  const snapshotId = randomUUID();
  const candidates = input.inventory.components
    .filter((component) => component.kind !== "mcp-server")
    .map((component) =>
      ({
        component,
        entry: capabilityEntry(
          snapshotId,
          component,
          input.inventory.packages,
          input.probe,
          input.policy,
          input.inventory.health ?? [],
          input.deliveryScope ?? "global-catalog"
        ),
      })
    );
  const entries = input.selection === "effective"
    ? selectEffectiveEntries(candidates, input.inventory.packages)
    : candidates.map((item) => item.entry);
  const base = {
    snapshotId,
    visibleInventoryVersion: input.inventory.visibleInventoryVersion,
    backendId: input.probe.backendId,
    backendRuntimeIdentity: input.probe.backendRuntimeIdentity,
    productPolicyRevision: input.policy.revision,
    createdAt: input.now ?? Date.now(),
    entries,
  };
  return { ...base, snapshotDigest: digestCanonical(base) };
}

export function buildEffectiveExtensionProjection(input: {
  inventory: ExtensionInventorySnapshot;
  probe: ExtensionBackendProbe;
  policy: ExtensionProductPolicy;
  now?: number;
  deliveryScope?: "global-catalog" | "app";
}) {
  const capability = buildExtensionCapabilitySnapshot({
    ...input,
    selection: "effective",
  });
  const selected = new Set(
    capability.entries.map((entry) =>
      componentKey(
        entry.componentInstanceIdentity,
        entry.packageGenerationRef.packageGenerationId,
        entry.packageGenerationRef.recordDigest
      )
    )
  );
  const { digest: _digest, ...base } = input.inventory;
  const payload = {
    ...base,
    components: input.inventory.components.filter((component) =>
      selected.has(
        componentKey(
          component.componentInstanceIdentity,
          component.packageGenerationRef.packageGenerationId,
          component.packageGenerationRef.recordDigest
        )
      )
    ),
  };
  return {
    inventory: { ...structuredClone(payload), digest: digestCanonical(payload) },
    capability,
  };
}

function componentKey(
  componentInstanceIdentity: string,
  packageGenerationId: string,
  recordDigest: string
) {
  return `${componentInstanceIdentity}\0${packageGenerationId}\0${recordDigest}`;
}

function selectEffectiveEntries(
  candidates: readonly Readonly<{
    component: ExtensionComponentRecord;
    entry: ExtensionCapabilityEntry;
  }>[],
  packages: readonly ExtensionInventoryPackage[]
) {
  const eligible = candidates.filter((item) => item.entry.eligible);
  const grouped = new Map<string, typeof eligible>();
  for (const candidate of eligible) {
    const values = grouped.get(candidate.component.declaredComponentIdentity) ?? [];
    values.push(candidate);
    grouped.set(candidate.component.declaredComponentIdentity, values);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, values]) => {
      const project = values.filter(
        (item) => ownerScope(item.component, packages) === "project"
      );
      const global = values.filter(
        (item) => ownerScope(item.component, packages) === "global"
      );
      if (project.length === 1) return [project[0]!.entry];
      if (project.length > 1 || global.length !== 1) return [];
      return [global[0]!.entry];
    });
}

function ownerScope(
  component: ExtensionComponentRecord,
  packages: readonly ExtensionInventoryPackage[]
) {
  return packages.find((owner) =>
    owner.generations.some(
      (generation) =>
        generation.packageGenerationId ===
          component.packageGenerationRef.packageGenerationId &&
        generation.recordDigest === component.packageGenerationRef.recordDigest
    )
  )?.scope.kind;
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
    componentInstanceIdentity: component.componentInstanceIdentity,
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
    return reason("backend-capability-mismatch", { component: component.componentInstanceIdentity });
  }
  if (health?.state === "degraded" || health?.state === "quarantined") {
    return reason("runtime-health-failed", {
      component: component.componentInstanceIdentity,
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
      !owner.enabledComponentInstanceIdentities.includes(
        component.componentInstanceIdentity
      ))
  ) {
    return reason("component-disabled", {
      component: component.componentInstanceIdentity,
    });
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
