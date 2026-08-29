/**
 * [INPUT]: Depends on frozen App graphs, live AppReference, scoped grants, authoritative inventory and main-owned capability snapshots
 * [OUTPUT]: Provides buildComponentDeliveryDecision and excludeFailedDeliveries, generates an immutable plan that is required→blocked, optional→degraded, all satisfied→ready
 * [POS]: The first step is to create a new version of the AppEach App requirement to actual delivery remains on the independent licensing side, and the materialization failure is recycled along the same side
 */

import { randomUUID } from "node:crypto";
import type {
  ComponentDeliveryDecision,
  ComponentDeliveryExclusion,
  ComponentDeliveryPlan,
  ExtensionCapabilitySnapshot,
  ExtensionInventorySnapshot,
  ExtensionTurnIdentity,
  FrozenAppExtensionRequirementSetV1,
  FrozenComponentDeliveryExclusionReason,
  FrozenExtensionDeliveryEligibilityReason,
  ScopedComponentGrant,
} from "../../../../shared/extensions-ipc";
import { digestCanonical } from "../registry-store";

export type AppDeliveryBindingInput = Readonly<{
  appId: string;
  appGenerationId: string;
  appReferenceLeaseId: string;
  agentDelegationEnabled: boolean;
  frozenSet: FrozenAppExtensionRequirementSetV1;
  appGrantAggregateRevision: number;
  grants: readonly ScopedComponentGrant[];
}>;

export function buildComponentDeliveryDecision(input: {
  apps: readonly AppDeliveryBindingInput[];
  inventory: ExtensionInventorySnapshot;
  capability: ExtensionCapabilitySnapshot;
  turnIdentity: ExtensionTurnIdentity;
  productAllowed?: (declaredComponentIdentity: string) => boolean;
}): ComponentDeliveryDecision {
  assertSnapshot(input.inventory, input.capability, input.turnIdentity);
  const exclusions: ComponentDeliveryExclusion[] = [];
  const materializations = new Map<string, ComponentDeliveryPlan["deliveries"][number]>();
  const appBindings: ComponentDeliveryPlan["appBindings"][number][] = [];

  for (const app of input.apps) {
    if (
      app.frozenSet.appGenerationId !== app.appGenerationId ||
      !app.appReferenceLeaseId
    ) {
      throw conflict("App reference/generation 与 frozen requirement graph 不一致");
    }
    const requirementBindings: ComponentDeliveryPlan["appBindings"][number]["requirementBindings"][number][] = [];
    for (const requirement of app.frozenSet.extensionRequirements) {
      if (requirement.state === "unresolved") {
        exclusions.push(exclusion(app, requirement, { kind: "inventory", reason: requirement.reason }));
        continue;
      }
      const denied = authorizationExclusion(app, requirement, input.productAllowed);
      if (denied) {
        exclusions.push(exclusion(app, requirement, denied));
        continue;
      }
      const grant = app.grants.find(
        (item) =>
          item.appId === app.appId &&
          item.appGenerationId === app.appGenerationId &&
          item.requirementResolutionDigest === app.frozenSet.resolutionDigest &&
          item.declarationDigest === requirement.declarationDigest &&
          item.componentInstanceIdentity ===
            requirement.componentInstanceIdentity &&
          item.packageGenerationRef.packageGenerationId ===
            requirement.packageGenerationRef.packageGenerationId &&
          item.packageGenerationRef.recordDigest ===
            requirement.packageGenerationRef.recordDigest &&
          item.resolvedConfigDigest === requirement.resolvedConfigDigest
      );
      if (!grant) {
        exclusions.push(
          exclusion(app, requirement, authorization("scoped-grant-missing", {}))
        );
        continue;
      }
      const capability = input.capability.entries.find(
        (item) =>
          item.componentInstanceIdentity ===
            requirement.componentInstanceIdentity &&
          item.packageGenerationRef.packageGenerationId ===
            requirement.packageGenerationRef.packageGenerationId &&
          item.packageGenerationRef.recordDigest ===
            requirement.packageGenerationRef.recordDigest
      );
      if (!capability?.eligible || !capability.deliveryReference) {
        const reason = capability?.exclusion ?? {
          taxonomyVersion: 1 as const,
          code: "backend-capability-mismatch" as const,
          parameters: {
            componentInstanceIdentity: requirement.componentInstanceIdentity,
          },
          evidenceDigest: digestCanonical({ requirement, capability: null }),
        };
        exclusions.push(
          exclusion(app, requirement, { kind: "delivery-eligibility", reason })
        );
        continue;
      }
      if (
        capability.deliveryReference.strength === "server-inclusion-only" &&
        input.turnIdentity.turnClass !== "manual"
      ) {
        exclusions.push(
          exclusion(
            app,
            requirement,
            authorization("product-policy-denied", {
              turnClass: input.turnIdentity.turnClass,
              channel: "third-party-mcp",
            })
          )
        );
        continue;
      }
      const materializationKey = digestCanonical({
        componentInstanceIdentity: requirement.componentInstanceIdentity,
        packageGenerationRef: requirement.packageGenerationRef,
        resolvedConfigDigest: requirement.resolvedConfigDigest,
        deliveryReference: capability.deliveryReference,
      });
      const collision = [...materializations.values()].find(
        (item) =>
          item.componentInstanceIdentity ===
            requirement.componentInstanceIdentity &&
          item.resolvedConfigDigest !== requirement.resolvedConfigDigest
      );
      if (collision && !capability.multiInstanceIsolation) {
        exclusions.push(
          exclusion(app, requirement, composition("multi-instance-conflict", {
            appId: app.appId,
            componentInstanceIdentity: requirement.componentInstanceIdentity,
          }))
        );
        continue;
      }
      let delivery = materializations.get(materializationKey);
      if (!delivery) {
        delivery = {
          deliveryInstanceId: randomUUID(),
          componentInstanceIdentity: requirement.componentInstanceIdentity,
          packageGenerationRef: requirement.packageGenerationRef,
          resolvedConfigDigest: requirement.resolvedConfigDigest,
          componentPlanLeaseId: randomUUID(),
          deliveryRef: capability.deliveryReference,
        };
        materializations.set(materializationKey, delivery);
      }
      requirementBindings.push({
        declarationDigest: requirement.declarationDigest,
        declaredComponentIdentity: requirement.declaredComponentIdentity,
        componentInstanceIdentity: requirement.componentInstanceIdentity,
        packageGenerationRef: requirement.packageGenerationRef,
        resolvedConfigDigest: requirement.resolvedConfigDigest,
        required: requirement.required,
        scopedGrantRevision: grant.grantRevision,
        deliveryInstanceId: delivery.deliveryInstanceId,
      });
    }
    appBindings.push({
      appId: app.appId,
      appGenerationId: app.appGenerationId,
      appReferenceLeaseId: app.appReferenceLeaseId,
      requirementResolutionDigest: app.frozenSet.resolutionDigest,
      appGrantAggregateRevision: app.appGrantAggregateRevision,
      requirementBindings,
    });
  }

  return converge(exclusions, {
    planInstanceId: randomUUID(),
    visibleInventoryVersion: input.inventory.visibleInventoryVersion,
    capabilitySnapshotDigest: input.capability.snapshotDigest,
    turnIdentity: input.turnIdentity,
    appBindings,
    deliveries: [...materializations.values()],
  });
}

/**
 * 物化失败后重新收敛：deliveryInstanceId 是 App 授权边到实际 delivery 的唯一
 * 连接点，所以「哪条 delivery 没物化出来」可以逐条翻译回受影响的 requirement
 * binding。required 命中即整轮 blocked——少给一条 required 而照常签发，就是把
 * 「Agent 拿到了能力」和「Agent 以为自己拿到了」混为一谈。
 */
export function excludeFailedDeliveries(
  decision: Extract<ComponentDeliveryDecision, { status: "ready" | "degraded" }>,
  failures: readonly Readonly<{
    deliveryInstanceId: string;
    reason: FrozenExtensionDeliveryEligibilityReason;
  }>[]
): ComponentDeliveryDecision {
  const failed = new Map(failures.map((item) => [item.deliveryInstanceId, item.reason]));
  if (!failed.size) return decision;
  const exclusions = [...decision.exclusions];
  const appBindings = decision.plan.appBindings.map((app) => ({
    ...app,
    requirementBindings: app.requirementBindings.filter((binding) => {
      const reason = failed.get(binding.deliveryInstanceId);
      if (!reason) return true;
      exclusions.push({
        appId: app.appId,
        appGenerationId: app.appGenerationId,
        requirementResolutionDigest: app.requirementResolutionDigest,
        declarationDigest: binding.declarationDigest,
        declaredComponentIdentity: binding.declaredComponentIdentity,
        required: binding.required,
        reason: { kind: "delivery-eligibility", reason },
      });
      return false;
    }),
  }));
  /* 逐字段列出而不是 `...decision.plan`：后者会把旧 planDigest 带进 digest 输入，
     于是同一份内容经两条路径算出两个 digest，缓存从此不可信。planInstanceId 保持
     不变——收窄后仍是同一轮的同一个计划，plan lease 与快照目录都按它寻址。 */
  return converge(exclusions, {
    planInstanceId: decision.plan.planInstanceId,
    visibleInventoryVersion: decision.plan.visibleInventoryVersion,
    capabilitySnapshotDigest: decision.plan.capabilitySnapshotDigest,
    turnIdentity: decision.plan.turnIdentity,
    appBindings,
    deliveries: decision.plan.deliveries.filter(
      (item) => !failed.has(item.deliveryInstanceId)
    ),
  });
}

/* required 判定与 planDigest 只有这一处：两条路径各算一次，迟早算出两种真相。 */
function converge(
  exclusions: readonly ComponentDeliveryExclusion[],
  base: Omit<ComponentDeliveryPlan, "planDigest">
): ComponentDeliveryDecision {
  if (exclusions.some((item) => item.required)) {
    return { status: "blocked", exclusions };
  }
  return {
    status: exclusions.length ? "degraded" : "ready",
    exclusions,
    plan: { ...base, planDigest: digestCanonical(base) },
  };
}

function authorizationExclusion(
  app: AppDeliveryBindingInput,
  requirement: Extract<
    FrozenAppExtensionRequirementSetV1["extensionRequirements"][number],
    { state: "resolved" }
  >,
  productAllowed: ((identity: string) => boolean) | undefined
) {
  if (!app.agentDelegationEnabled) {
    return authorization("attachment-delegation-disabled", {});
  }
  if (
    productAllowed &&
    !productAllowed(requirement.declaredComponentIdentity)
  ) {
    return authorization("product-policy-denied", {});
  }
  return undefined;
}

function exclusion(
  app: AppDeliveryBindingInput,
  requirement: FrozenAppExtensionRequirementSetV1["extensionRequirements"][number],
  reason: FrozenComponentDeliveryExclusionReason
): ComponentDeliveryExclusion {
  return {
    appId: app.appId,
    appGenerationId: app.appGenerationId,
    requirementResolutionDigest: app.frozenSet.resolutionDigest,
    declarationDigest: requirement.declarationDigest,
    declaredComponentIdentity: requirement.declaredComponentIdentity,
    required: requirement.required,
    reason,
  };
}

function authorization(
  code: Extract<FrozenComponentDeliveryExclusionReason, { kind: "authorization" }>["code"],
  parameters: Record<string, string>
): FrozenComponentDeliveryExclusionReason {
  return {
    kind: "authorization",
    taxonomyVersion: 1,
    code,
    parameters,
    evidenceDigest: digestCanonical({ code, parameters }),
  };
}

function composition(
  code: Extract<FrozenComponentDeliveryExclusionReason, { kind: "composition" }>["code"],
  parameters: Record<string, string>
): FrozenComponentDeliveryExclusionReason {
  return {
    kind: "composition",
    taxonomyVersion: 1,
    code,
    parameters,
    evidenceDigest: digestCanonical({ code, parameters }),
  };
}

function assertSnapshot(
  inventory: ExtensionInventorySnapshot,
  capability: ExtensionCapabilitySnapshot,
  turn: ExtensionTurnIdentity
) {
  if (
    capability.visibleInventoryVersion !== inventory.visibleInventoryVersion ||
    turn.visibleInventoryVersion !== inventory.visibleInventoryVersion ||
    capability.backendId !== turn.backendId ||
    capability.backendRuntimeIdentity !== turn.backendRuntimeIdentity
  ) {
    throw conflict("Extension inventory/capability/turn snapshot 已漂移");
  }
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}
