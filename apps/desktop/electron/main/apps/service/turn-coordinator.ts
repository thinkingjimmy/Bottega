/**
 * [INPUT]: Depends on AppStore, Project-scoped Extension integration, grant authority, lifecycle/usage gates, reference/plan ledgers, and delivery materializer
 * [OUTPUT]: Provides AppTurnCoordinator for exact Project-aware reference acquisition, Extension delivery/health, Agent visibility, custody, and release
 * [POS]: App service turn authority; frozen App generation bindings are projected once and never re-resolved against live Extension precedence
 */

import { join } from "node:path";
import type {
  AppAgentDegradation,
  AppAgentOmission,
  AppCapabilityGrant,
  AppInstallEvent,
  AppRecord,
} from "../../../../shared/apps-ipc";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { BaseToolsAvailability } from "../../../../shared/builtin-tools";
import type { AgentTurnCustodyDependency } from "../../../../shared/app-lifecycle";
import type { TurnProjectContext } from "../../../../shared/product-resource-scope";
import type {
  ComponentDeliveryExclusion,
  ComponentDeliveryPlan,
  ExtensionTurnIdentity,
} from "../../../../shared/extensions-ipc";
import {
  mcpBackendAlias,
  type ThirdPartyMcpPlanEntry,
} from "../../../../shared/mcp-servers-ipc";
import { removeReadonlySnapshot } from "../../agent-input";
import { buildExtensionCapabilitySnapshot } from "../../extensions/capability-snapshot";
import type { AppExtensionIntegration } from "../../extensions/integration/app-extension-composition";
import {
  buildComponentDeliveryDecision,
  excludeFailedDeliveries,
} from "../../extensions/integration/delivery-planner";
import {
  materializeComponentDeliveries,
  type MaterializedExtensionMcpServer,
  type MaterializedExtensionSkill,
} from "../../extensions/integration/delivery-materializer";
import {
  EXTENSION_PRODUCT_POLICY,
  backendExtensionProbe,
} from "../../extensions/product-policy";
import type {
  AppLifecycleAdmissionGate,
  AppUsageRegistry,
} from "../../lifecycle/app-platform-admission";
import type { AppGrantAuthority } from "../attachments/grant-authority";
import {
  collectAppSkillEntries,
  type AppInstructionContributorRegistry,
} from "../app-instruction-contributors";
import type { AppReferenceJournal } from "../app-reference-journal";
import type { AppStore } from "../app-store";
import { selectAppReferences } from "../grant-budget";
import type { ThirdPartyMcpPlanLedger } from "../../extensions/lifecycle/third-party-mcp-plan-ledger";
import type { AgentContext } from "../../agent/bridge-types";
import { appDigest } from "./digest";

type TurnInput = {
  conversationId: string;
  requestId: string;
  backendId: AgentBackendId;
  backendRuntimeIdentity: string;
  turnClass: ExtensionTurnIdentity["turnClass"];
  planMode: boolean;
  projectContext: TurnProjectContext;
  /** 与 tool lease 同源的本轮访问档；none 表示该 backend 没有 instructions 通道 */
  toolAccess: "none" | "read" | "mutate";
  baseToolsAvailability?: BaseToolsAvailability;
};

type AppTurnCoordinatorDependencies = {
  userData: string;
  store: AppStore;
  lifecycleGate: AppLifecycleAdmissionGate;
  usageRegistry: AppUsageRegistry;
  referenceJournal: AppReferenceJournal;
  thirdPartyMcpPlans: ThirdPartyMcpPlanLedger;
  instructionContributors: AppInstructionContributorRegistry;
  grantAuthority(): AppGrantAuthority;
  extensions(): AppExtensionIntegration | null;
  emit(event: AppInstallEvent): void;
};

export class AppTurnCoordinator {
  private readonly turnUsageLeases = new Map<string, string[]>();
  private readonly visibilityRevisions = new Map<string, number>();
  /* 物化产物与 plan lease 同生共死：root 只是本轮私有目录，不是第二本引用账。 */
  private readonly turnDeliveries = new Map<
    string,
    {
      root: string;
      skills: readonly MaterializedExtensionSkill[];
      mcpServers: readonly ThirdPartyMcpPlanEntry[];
    }
  >();

  constructor(private readonly deps: AppTurnCoordinatorDependencies) {}

  async acquire(input: TurnInput) {
    const effective = await this.deps.grantAuthority().effectiveGrants(
      input.conversationId
    );
    const candidates = effective.flatMap((item) => {
      if (
        !item.grant.agentDelegation.fileRead &&
        !item.grant.agentDelegation.useData
      ) {
        return [];
      }
      const record = this.deps.store.get(item.appId);
      const active = record?.generationBinding.active;
      const generation = record?.generations.find(
        (value) => value.generationId === active?.generationId
      );
      if (
        !record ||
        record.state !== "ready" ||
        !record.domainIdentity ||
        !active ||
        !generation ||
        !this.deps.lifecycleGate.isOpen(record.id)
      ) {
        return [];
      }
      const usage = this.deps.usageRegistry.acquire({
        appId: record.id,
        generationId: generation.generationId,
        lifecycleRevision: record.lifecycleRevision,
      });
      return [{ item, record, generation, usage }];
    });
    /* 超出引用上限的不是错误，是「这几个 App 本轮对 Agent 不存在」。 */
    const { accepted, omittedAppIds } = selectAppReferences(
      candidates,
      ({ record }) => record.id
    );
    for (const dropped of candidates.slice(accepted.length)) {
      this.deps.usageRegistry.release(dropped.usage.usageLeaseId);
    }
    if (!accepted.length) {
      this.publishVisibility(
        input,
        null,
        omittedAppIds.map((appId) => ({
          appId,
          reason: "reference-limit" as const,
        })),
        [],
        [],
        []
      );
      return {
        referenceEntryIds: [],
        readOnlyRoots: [],
        instructions: "",
        extensionExclusions: [],
        mcpServers: [],
        extensionDiscoveryBindings: [],
      };
    }
    try {
      const entries = await this.deps.referenceJournal.acquireMany({
        turnRequestId: input.requestId,
        owner: {
          kind: "chat-turn",
          ownerId: input.conversationId,
          ownerRevision: 0,
        },
        references: accepted.map(({ item, record, generation }) => ({
          appId: record.id,
          generationId: generation.generationId,
          contentDigest: generation.contentDigest,
          lifecycleRevision: record.lifecycleRevision,
          capability: {
            data: effectiveDataCapability(item.grant),
            fileRead: item.grant.agentDelegation.fileRead,
            useData: item.grant.agentDelegation.useData,
            backendId: input.backendId,
            snapshotDigest: appDigest(item.snapshot),
          },
        })),
      });
      await this.deps.referenceJournal.activateMany(input.requestId);
      this.turnUsageLeases.set(
        input.requestId,
        accepted.map(({ usage }) => usage.usageLeaseId)
      );
      const skillEntries = await Promise.all(
        accepted.map(({ item, record }) =>
          item.grant.agentDelegation.fileRead
            ? collectAppSkillEntries(record.dir).catch(() => [])
            : Promise.resolve([])
        )
      );
      const projected = this.deps.instructionContributors.project({
        apps: accepted.map(({ record, generation }, index) => ({
          identity: record.domainIdentity!,
          context: {
            appId: record.id,
            appName: record.manifest?.name ?? record.displayName,
            generationId: generation.generationId,
            referenceLeaseId: entries[index]!.leaseId,
            capability: entries[index]!.frozenCapability,
            mutationsAllowed: input.toolAccess === "mutate",
            baseToolsAvailability:
              input.baseToolsAvailability ??
              (input.toolAccess === "mutate" ? "read-write" : "read-only"),
            skillEntries: skillEntries[index]!,
          },
        })),
      });
      const unsupported =
        input.toolAccess === "none" ? projected.contributingAppIds : [];
      const delivery = await this.planExtensionDeliveries(input, {
        apps: accepted.map(({ item, record, generation }, index) => ({
          appId: record.id,
          appGenerationId: generation.generationId,
          appReferenceLeaseId: entries[index]!.leaseId,
          agentDelegationEnabled: item.grant.agentDelegation.useData,
          resolution: generation.extensionRequirementResolution,
        })),
      });
      this.publishVisibility(
        input,
        delivery.planInstanceId,
        [
          ...omittedAppIds.map((appId) => ({
            appId,
            reason: "reference-limit" as const,
          })),
          ...projected.omittedAppIds.map((appId) => ({
            appId,
            reason: "instruction-budget" as const,
          })),
          ...unsupported.map((appId) => ({
            appId,
            reason: "backend-unsupported" as const,
          })),
          ...projected.unavailableAppIds.map((appId) => ({
            appId,
            reason: "base-tools-disabled" as const,
          })),
        ],
        projected.degradedApps,
        delivery.exclusions,
        delivery.activeComponents
      );
      return {
        referenceEntryIds: entries.map((entry) => entry.journalEntryId),
        readOnlyRoots: accepted.flatMap(({ item, record }) =>
          item.grant.agentDelegation.fileRead ? [record.dir] : []
        ),
        instructions: unsupported.length ? "" : projected.instructions,
        extensionExclusions: delivery.exclusions,
        mcpServers: delivery.mcpServers,
        extensionDiscoveryBindings: delivery.discoveryBindings,
      };
    } catch (cause) {
      /* durable entry 可能已落盘，失败必须走统一释放路径，否则 generation 永不归零。 */
      this.turnUsageLeases.set(
        input.requestId,
        accepted.map(({ usage }) => usage.usageLeaseId)
      );
      await this.release(input.requestId);
      throw cause;
    }
  }

  private publishVisibility(
    turn: Pick<TurnInput, "conversationId" | "requestId" | "backendRuntimeIdentity">,
    planInstanceId: string | null,
    omittedApps: readonly AppAgentOmission[],
    degradedApps: readonly AppAgentDegradation[],
    exclusions: readonly ComponentDeliveryExclusion[],
    activeComponents: readonly Readonly<{
      appId: string;
      componentInstanceIdentity: string;
    }>[]
  ) {
    const revision =
      (this.visibilityRevisions.get(turn.conversationId) ?? 0) + 1;
    this.visibilityRevisions.set(turn.conversationId, revision);
    this.deps.emit({
      type: "agent-visibility",
      visibility: {
        conversationId: turn.conversationId,
        attemptGeneration: turn.requestId,
        planInstanceId,
        runtimeSnapshotId: turn.backendRuntimeIdentity,
        revision,
        omittedApps: [...omittedApps],
        degradedApps: [...degradedApps],
        excludedComponents: exclusions.map((item) => ({
          appId: item.appId,
          declaredComponentIdentity: item.declaredComponentIdentity,
          required: item.required,
          code:
            item.reason.kind === "inventory" ||
            item.reason.kind === "delivery-eligibility"
              ? item.reason.reason.code
              : item.reason.code,
        })),
        activeComponents: [...activeComponents],
      },
    });
  }

  private async planExtensionDeliveries(
    turn: Pick<
      TurnInput,
      | "requestId"
      | "backendId"
      | "backendRuntimeIdentity"
      | "turnClass"
      | "planMode"
      | "projectContext"
    >,
    input: {
      apps: readonly {
        appId: string;
        appGenerationId: string;
        appReferenceLeaseId: string;
        agentDelegationEnabled: boolean;
        resolution: AppRecord["generations"][number]["extensionRequirementResolution"];
      }[];
    }
  ): Promise<{
    exclusions: readonly ComponentDeliveryExclusion[];
    skills: readonly MaterializedExtensionSkill[];
    mcpServers: readonly ThirdPartyMcpPlanEntry[];
    planInstanceId: string | null;
    activeComponents: readonly Readonly<{
      appId: string;
      componentInstanceIdentity: string;
    }>[];
    discoveryBindings: NonNullable<
      AgentContext["extensionDiscoveryBindings"]
    >;
  }> {
    const extensions = this.deps.extensions();
    const bindings = input.apps.flatMap((app) =>
      app.resolution.kind === "frozen"
        ? [
            {
              ...app,
              frozenSet: app.resolution.frozenSet,
              appGrantAggregateRevision:
                extensions?.grants.snapshot(app.appId)?.revision ?? 0,
              grants:
                extensions?.grants.exactGrants(
                  app.appId,
                  app.appGenerationId
                ) ?? [],
            },
          ]
        : []
    );
    if (!extensions || !bindings.length) {
      return {
        exclusions: [],
        skills: [],
        mcpServers: [],
        planInstanceId: null,
        activeComponents: [],
        discoveryBindings: [],
      };
    }
    const inventory = extensions.health.inventory(
      extensions.registry.visibleInventory(turn.projectContext)
    );
    const capability = buildExtensionCapabilitySnapshot({
      inventory,
      probe: backendExtensionProbe(
        turn.backendId,
        turn.backendRuntimeIdentity,
        turn.backendRuntimeIdentity
      ),
      policy: EXTENSION_PRODUCT_POLICY,
      deliveryScope: "app",
      selection: "effective",
    });
    const decision = buildComponentDeliveryDecision({
      apps: bindings,
      inventory,
      capability,
      turnIdentity: {
        turnClass: turn.turnClass,
        planMode: turn.planMode,
        backendId: turn.backendId,
        backendRuntimeIdentity: turn.backendRuntimeIdentity,
        projectContext: turn.projectContext,
        visibleInventoryVersion: inventory.visibleInventoryVersion,
        workspace: { kind: "none" },
      },
    });
    if (decision.status === "blocked") {
      return {
        exclusions: decision.exclusions,
        skills: [],
        mcpServers: [],
        planInstanceId: null,
        activeComponents: [],
        discoveryBindings: [],
      };
    }
    await this.deps.thirdPartyMcpPlans.hold(turn.requestId, decision.plan);
    const root = join(
      this.deps.userData,
      "agent-extensions",
      "turn-snapshots",
      decision.plan.planInstanceId
    );
    this.turnDeliveries.set(turn.requestId, {
      root,
      skills: [],
      mcpServers: [],
    });
    let materialized;
    try {
      materialized = await materializeComponentDeliveries({
        root,
        userData: this.deps.userData,
        inventory,
        capability,
        plan: decision.plan,
      });
    } catch (cause) {
      await this.releasePlan(turn.requestId);
      throw cause;
    }
    await this.deps.thirdPartyMcpPlans.sealResolvedConfigs(
      turn.requestId,
      materialized.mcpServers
    );
    const converged = excludeFailedDeliveries(
      decision,
      materialized.failures
    );
    if (converged.status === "blocked") {
      await this.releasePlan(turn.requestId);
      return {
        exclusions: converged.exclusions,
        skills: [],
        mcpServers: [],
        planInstanceId: decision.plan.planInstanceId,
        activeComponents: [],
        discoveryBindings: [],
      };
    }
    const mcpServers = packageMcpPlanEntries(
      decision.plan,
      materialized.mcpServers,
      turn.backendId,
      turn.backendRuntimeIdentity
    );
    this.turnDeliveries.set(turn.requestId, {
      root,
      skills: materialized.skills,
      mcpServers,
    });
    const activeIds = new Set([
      ...materialized.skills.map((item) => item.deliveryInstanceId),
      ...materialized.mcpServers.map((item) => item.deliveryInstanceId),
    ]);
    await this.deps.thirdPartyMcpPlans.sealMaterializedDeliveries(
      turn.requestId,
      [...activeIds]
    );
    return {
      exclusions: converged.exclusions,
      skills: materialized.skills,
      mcpServers,
      planInstanceId: decision.plan.planInstanceId,
      activeComponents: decision.plan.appBindings.flatMap((binding) =>
        binding.requirementBindings
          .filter((requirement) =>
            activeIds.has(requirement.deliveryInstanceId)
          )
          .map((requirement) => ({
            appId: binding.appId,
            componentInstanceIdentity:
              requirement.componentInstanceIdentity,
          }))
      ),
      discoveryBindings: decision.plan.deliveries
        .filter((delivery) => activeIds.has(delivery.deliveryInstanceId))
        .map((delivery) => ({
          kind: "app-delivery" as const,
          authorityId: delivery.deliveryInstanceId,
          planInstanceId: decision.plan.planInstanceId,
          packageGenerationRef: structuredClone(
            delivery.packageGenerationRef
          ),
          componentInstanceIdentity: delivery.componentInstanceIdentity,
          deliveryIdentity: delivery.deliveryRef.entryDigest,
        })),
    };
  }

  skills(requestId: string): readonly MaterializedExtensionSkill[] {
    return this.turnDeliveries.get(requestId)?.skills ?? [];
  }

  mcpServers(requestId: string): readonly ThirdPartyMcpPlanEntry[] {
    return this.turnDeliveries.get(requestId)?.mcpServers ?? [];
  }

  custodyDependencies(requestId: string): AgentTurnCustodyDependency[] {
    const references = this.deps.referenceJournal
      .listActive(requestId)
      .map((entry) => ({
        kind: "app-reference" as const,
        journalEntryId: entry.journalEntryId,
      }));
    const plan = this.deps.thirdPartyMcpPlans.dependency(requestId);
    return plan ? [...references, plan] : references;
  }

  async release(requestId: string) {
    await this.deps.referenceJournal.releaseMany(requestId);
    for (const leaseId of this.turnUsageLeases.get(requestId) ?? []) {
      this.deps.usageRegistry.release(leaseId);
    }
    this.turnUsageLeases.delete(requestId);
    await this.releasePlan(requestId);
  }

  private async releasePlan(requestId: string) {
    const delivered = this.turnDeliveries.get(requestId);
    this.turnDeliveries.delete(requestId);
    if (delivered) await removeReadonlySnapshot(delivered.root);
    await this.deps.thirdPartyMcpPlans.release(requestId);
  }
}

function packageMcpPlanEntries(
  plan: ComponentDeliveryPlan,
  servers: readonly MaterializedExtensionMcpServer[],
  backend: AgentBackendId,
  runtimeVersion: string
): ThirdPartyMcpPlanEntry[] {
  return servers.flatMap((server) => {
    if (server.config.transport !== "stdio") return [];
    const appId = plan.appBindings
      .filter((binding) =>
        binding.requirementBindings.some(
          (item) => item.deliveryInstanceId === server.deliveryInstanceId
        )
      )
      .map((binding) => binding.appId)
      .sort()[0];
    const generation = `${server.packageGenerationRef.packageGenerationId}@${server.packageGenerationRef.recordDigest}`;
    const identity = `pkg:${server.packageGenerationRef.packageGenerationId}:${server.serverId}`;
    return [
      {
        identity,
        backendAlias: mcpBackendAlias(identity),
        displayName: server.serverId,
        source: appId
          ? {
              kind: "app-requirement" as const,
              appId,
              generationRef: generation,
            }
          : {
              kind: "package-global" as const,
              generationRef: generation,
            },
        transport: "stdio" as const,
        command: server.config.command,
        args: [...server.config.args],
        env: { ...server.config.env },
        ...(server.config.cwd ? { cwd: server.config.cwd } : {}),
        configDigest: server.resolvedConfigDigest,
        healthSubject: {
          kind: "package" as const,
          generationRef: structuredClone(server.packageGenerationRef),
          componentInstanceIdentity: server.componentInstanceIdentity,
          componentId: server.componentId,
          serverId: server.serverId,
          declaredConfigDigest: server.declaredConfigDigest,
          resolvedConfigDigest: server.resolvedConfigDigest,
          backend,
          runtimeVersion,
          transport: "stdio" as const,
        },
      },
    ];
  });
}

function effectiveDataCapability(
  grant: AppCapabilityGrant
): "none" | "base-read" | "base-row-write" {
  if (!grant.agentDelegation.useData || !grant.data) return "none";
  return grant.data.level === "row-write" ? "base-row-write" : "base-read";
}
