/**
 * [INPUT]: Depends on durable-json, ComponentDeliveryPlan, v1-to-v3 plan migration, execution config digests, and Registry generation-ref narrow ports
 * [OUTPUT]: Provides ThirdPartyMcpPlanLedger: safe legacy startup, intent-before-ref, exact delivery/session receipts, config seal, holder queries, and crash reconciliation
 * [POS]: The third-party MCP/component plan and App-delivery session authority; request release retains only generations proven discovered by a live backend session
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type ComponentDeliveryPlan,
  type ExtensionPackageGenerationRef,
} from "../../../../shared/extensions-ipc";
import type { AgentTurnCustodyDependency } from "../../../../shared/app-lifecycle";
import { DurableJson } from "../../persistence/durable-json";
import { digestCanonical } from "../registry-store";
import {
  activePlanSessionRefs,
  planBindingSchema,
  planDigestSchema,
  planGenerationRefKey,
  planSessionHandoffSchema,
  thirdPartyMcpPlanEntrySchema,
  thirdPartyMcpPlanFileSchema,
  upgradeThirdPartyMcpPlanFile,
  type ThirdPartyMcpPlanBinding,
  type ThirdPartyMcpPlanEntry,
  type ThirdPartyMcpPlanFile,
} from "./third-party-mcp-plan-schema";

export type GenerationRefPort = Readonly<{
  acquireMany(
    refs: readonly ExtensionPackageGenerationRef[],
    owner: string
  ): Promise<Readonly<{
    created: readonly ExtensionPackageGenerationRef[];
    existed: readonly ExtensionPackageGenerationRef[];
  }>>;
  releaseMany(
    refs: readonly ExtensionPackageGenerationRef[],
    owner: string
  ): Promise<unknown>;
}>;

export class ThirdPartyMcpPlanLedger {
  private readonly file: DurableJson<ThirdPartyMcpPlanFile>;
  private refs: GenerationRefPort | null = null;

  constructor(userData: string) {
    this.file = new DurableJson(
      join(userData, "agent-extensions", "third-party-mcp-plans.json"),
      thirdPartyMcpPlanFileSchema,
      () => ({ schemaVersion: 3, revision: 0, entries: [] })
    );
  }

  get filePath() {
    return this.file.filePath;
  }

  initialize() {
    return this.file.initialize(upgradeThirdPartyMcpPlanFile);
  }

  configure(port: GenerationRefPort) {
    if (this.refs) throw new Error("ThirdPartyMcpPlanLedger ref port 已配置");
    this.refs = port;
  }

  async hold(requestId: string, plan: ComponentDeliveryPlan) {
    if (!this.refs) throw new Error("ThirdPartyMcpPlanLedger 尚未连接 Registry");
    const existing = this.byRequest(requestId);
    if (existing) {
      if (existing.planInstanceId !== plan.planInstanceId || existing.phase !== "active") {
        throw new Error("request 已绑定另一条未收敛 MCP plan");
      }
      return existing;
    }
    const bindings = planBindings(plan);
    await this.file.mutate((state) => {
      state.entries.push(thirdPartyMcpPlanEntrySchema.parse({
        requestId,
        planInstanceId: plan.planInstanceId,
        owner: `plan:${plan.planInstanceId}`,
        componentPlanLeaseIds: plan.deliveries.map((item) => item.componentPlanLeaseId),
        bindings,
        sourcePlanDigest: plan.planDigest,
        projectContext: structuredClone(plan.turnIdentity.projectContext),
        executionPlanDigest: null,
        resolvedMcpDeliveryInstanceIds: [],
        materializedDeliveryInstanceIds: [],
        sessionHandoffs: [],
        sessionRevocations: [],
        requestReleasedAt: null,
        retainedGenerationRefs: [],
        phase: "preparing",
        revision: 0,
      }));
      state.revision += 1;
    });
    try {
      await this.acquireAll(this.byRequest(requestId)!);
      return await this.advance(requestId, "preparing", "active");
    } catch (cause) {
      await this.markReleasePending(requestId);
      await this.releaseAll(this.byRequest(requestId)!);
      await this.advance(requestId, "release-pending", "released");
      await this.compactReleased(requestId);
      throw cause;
    }
  }

  /**
   * generation ref 已先持有，随后才允许把绝对 executable/cwd、展开 env 的摘要
   * 封进 execution plan。custody 不接受未 seal 的计划，杜绝 admission 摘要冒充执行身份。
   */
  sealResolvedConfigs(
    requestId: string,
    resolutions: readonly Readonly<{
      deliveryInstanceId: string;
      resolvedConfigDigest: `sha256:${string}`;
    }>[]
  ) {
    return this.file.mutate((state) => {
      const entry = state.entries.find(
        (item) => item.requestId === requestId && item.phase === "active"
      );
      if (!entry) throw new Error("MCP execution plan 不在 active phase");
      const seen = new Set<string>();
      for (const resolution of resolutions) {
        if (seen.has(resolution.deliveryInstanceId)) {
          throw new Error("MCP execution plan 含重复 delivery");
        }
        seen.add(resolution.deliveryInstanceId);
        const binding = entry.bindings.find(
          (item) => item.deliveryInstanceId === resolution.deliveryInstanceId
        );
        if (!binding) throw new Error("MCP execution digest 找不到 plan binding");
        binding.resolvedConfigDigest = planDigestSchema.parse(
          resolution.resolvedConfigDigest
        );
      }
      entry.resolvedMcpDeliveryInstanceIds = [...seen].sort();
      entry.executionPlanDigest = digestCanonical({
        sourcePlanDigest: entry.sourcePlanDigest,
        resolvedMcpBindings: entry.bindings
          .filter((binding) => seen.has(binding.deliveryInstanceId))
          .map((binding) => ({
            deliveryInstanceId: binding.deliveryInstanceId,
            sourceIdentity: binding.sourceIdentity,
            generationRef: binding.generationRef,
            resolvedConfigDigest: binding.resolvedConfigDigest,
          }))
          .sort((left, right) =>
            left.deliveryInstanceId.localeCompare(right.deliveryInstanceId)
          ),
      });
      entry.revision += 1;
      state.revision += 1;
      return entry;
    });
  }

  sealMaterializedDeliveries(
    requestId: string,
    deliveryInstanceIds: readonly string[]
  ) {
    return this.file.mutate((state) => {
      const entry = state.entries.find(
        (item) => item.requestId === requestId && item.phase === "active"
      );
      if (!entry) throw new Error("Extension delivery plan 不在 active phase");
      const unique = [...new Set(deliveryInstanceIds)].sort();
      if (
        unique.some(
          (deliveryId) =>
            !entry.bindings.some(
              (binding) => binding.deliveryInstanceId === deliveryId
            )
        )
      ) {
        throw new Error("materialized delivery 不属于 frozen plan");
      }
      entry.materializedDeliveryInstanceIds = unique;
      entry.revision += 1;
      state.revision += 1;
      return entry;
    });
  }

  handoffSession(input: {
    requestId: string;
    conversationId: string;
    session: { backend: "codex" | "claude" | "kimi" | "opencode"; id: string };
    backendRuntimeIdentity: string;
    projectContext: { projectId: string | null; projectLifecycleRevision: number | null };
    discoveries: readonly Readonly<{
      deliveryInstanceId: string;
      planInstanceId: string;
      packageGenerationRef: ExtensionPackageGenerationRef;
      componentInstanceIdentity: string;
      deliveryIdentity: `sha256:${string}`;
    }>[];
  }, now = Date.now()) {
    return this.file.mutate((state) => {
      const entry = state.entries.find(
        (item) => item.requestId === input.requestId && item.phase === "active"
      );
      if (!entry || entry.requestReleasedAt !== null) {
        throw conflict("Extension delivery plan 已释放，拒绝 session handoff");
      }
      for (const receipt of entry.sessionHandoffs) {
        if (
          receipt.conversationId === input.conversationId &&
          receipt.releasedAt === null &&
          (receipt.backend !== input.session.backend || receipt.sessionId !== input.session.id)
        ) {
          receipt.releasedAt = now;
        }
      }
      for (const discovery of input.discoveries) {
        const binding = entry.bindings.find(
          (item) => item.deliveryInstanceId === discovery.deliveryInstanceId
        );
        this.assertMaterializedBinding(entry, binding, discovery, input);
        if (
          entry.sessionRevocations.some((revocation) =>
            revocation.componentInstanceIdentities.includes(
              discovery.componentInstanceIdentity
            )
          )
        ) {
          throw conflict("Extension delivery 已进入 revoke fence，拒绝迟到 session handoff");
        }
        const exists = entry.sessionHandoffs.some(
          (receipt) =>
            receipt.releasedAt === null &&
            receipt.conversationId === input.conversationId &&
            receipt.backend === input.session.backend &&
            receipt.sessionId === input.session.id &&
            receipt.deliveryInstanceId === discovery.deliveryInstanceId
        );
        if (exists) continue;
        entry.sessionHandoffs.push(planSessionHandoffSchema.parse({
          receiptId: randomUUID(),
          conversationId: input.conversationId,
          backend: input.session.backend,
          backendRuntimeIdentity: input.backendRuntimeIdentity,
          sessionId: input.session.id,
          deliveryInstanceId: discovery.deliveryInstanceId,
          generationRef: discovery.packageGenerationRef,
          componentInstanceIdentity: discovery.componentInstanceIdentity,
          deliveryIdentity: discovery.deliveryIdentity,
          acquiredAt: now,
          releasedAt: null,
          revokedByOperationId: null,
        }));
      }
      entry.revision += 1;
      state.revision += 1;
      return structuredClone(entry.sessionHandoffs.filter(
        (receipt) =>
          receipt.conversationId === input.conversationId &&
          receipt.backend === input.session.backend &&
          receipt.sessionId === input.session.id &&
          receipt.releasedAt === null
      ));
    });
  }

  /** 可在 Registry 尚未初始化时调用；真正 release 留给随后一次 reconcile。 */
  async release(requestId: string, now = Date.now()) {
    const entry = this.byRequest(requestId);
    if (!entry || entry.phase === "released") return;
    if (entry.phase === "active" || entry.phase === "preparing") {
      await this.file.mutate((state) => {
        const current = state.entries.find(
          (item) => item.requestId === requestId && item.phase !== "released"
        );
        if (!current) return;
        current.requestReleasedAt ??= now;
        current.retainedGenerationRefs = activePlanSessionRefs(current);
        current.phase = "release-pending";
        current.revision += 1;
        state.revision += 1;
      });
    }
    if (!this.refs) return;
    const pending = this.byRequest(requestId);
    if (!pending) return;
    if (pending.phase === "session-held") return;
    const keep = activePlanSessionRefs(pending);
    const retained = new Set(keep.map(planGenerationRefKey));
    await this.releaseRefs(
      pending,
      [...uniqueGenerationBindings(pending.bindings)]
        .map((binding) => binding.generationRef)
        .filter((ref) => !retained.has(planGenerationRefKey(ref)))
    );
    await this.file.mutate((state) => {
      const current = state.entries.find(
        (item) => item.requestId === requestId && item.phase === "release-pending"
      );
      if (!current) return;
      current.retainedGenerationRefs = keep;
      current.phase = keep.length ? "session-held" : "released";
      current.revision += 1;
      state.revision += 1;
    });
    if (!keep.length) await this.compactReleased(requestId);
  }

  beginSessionRevoke(
    operationId: string,
    componentInstanceIdentities: ReadonlySet<string>,
    now = Date.now()
  ) {
    return this.file.mutate((state) => {
      for (const entry of state.entries) {
        if (entry.phase === "released") continue;
        const matches = entry.bindings
          .filter((binding) => componentInstanceIdentities.has(binding.sourceIdentity))
          .map((binding) => binding.sourceIdentity);
        if (!matches.length) continue;
        if (!entry.sessionRevocations.some((item) => item.operationId === operationId)) {
          entry.sessionRevocations.push({
            operationId,
            componentInstanceIdentities: [...new Set(matches)].sort(),
            begunAt: now,
          });
        }
        for (const receipt of entry.sessionHandoffs) {
          if (
            receipt.releasedAt === null &&
            componentInstanceIdentities.has(receipt.componentInstanceIdentity)
          ) {
            receipt.revokedByOperationId = operationId;
          }
        }
        entry.revision += 1;
        state.revision += 1;
      }
    });
  }

  sessionsAffected(operationId: string) {
    const sessions = new Map<string, {
      conversationId: string;
      backend: "codex" | "claude" | "kimi" | "opencode";
      sessionId: string;
    }>();
    for (const entry of this.file.snapshot().entries) {
      for (const receipt of entry.sessionHandoffs) {
        if (
          receipt.releasedAt !== null ||
          receipt.revokedByOperationId !== operationId
        ) continue;
        const key = `${receipt.conversationId}\0${receipt.backend}\0${receipt.sessionId}`;
        sessions.set(key, {
          conversationId: receipt.conversationId,
          backend: receipt.backend,
          sessionId: receipt.sessionId,
        });
      }
    }
    return [...sessions.values()];
  }

  async releaseSessionDiscovery(
    conversationId: string,
    session?: { backend: string; id: string },
    now = Date.now()
  ) {
    const affected = await this.file.mutate((state) => {
      const requestIds: string[] = [];
      for (const entry of state.entries) {
        let changed = false;
        for (const receipt of entry.sessionHandoffs) {
          if (
            receipt.conversationId === conversationId &&
            receipt.releasedAt === null &&
            (!session ||
              (receipt.backend === session.backend && receipt.sessionId === session.id))
          ) {
            receipt.releasedAt = now;
            changed = true;
          }
        }
        if (!changed) continue;
        if (entry.requestReleasedAt !== null) {
          entry.retainedGenerationRefs = activePlanSessionRefs(entry);
        }
        entry.revision += 1;
        state.revision += 1;
        if (entry.phase === "session-held") {
          entry.phase = "release-pending";
          requestIds.push(entry.requestId);
        }
      }
      return requestIds;
    });
    for (const requestId of affected) {
      await this.release(requestId, now);
    }
  }

  /**
   * startup custody 已先给出仍活的 request。其余 preparing/active 都是
   * intent-before-custody 崩溃残片，必须释放；quarantine 则重新宣告全部 ref。
   */
  async reconcile(activeRequestIds: ReadonlySet<string>) {
    if (!this.refs) throw new Error("ThirdPartyMcpPlanLedger 尚未连接 Registry");
    for (const current of this.file.snapshot().entries) {
      if (current.phase === "released") continue;
      if (
        activeRequestIds.has(current.requestId) &&
        current.requestReleasedAt === null &&
        current.phase !== "release-pending"
      ) {
        await this.acquireAll(current);
        if (current.phase === "preparing") {
          await this.advance(current.requestId, "preparing", "active");
        }
        continue;
      }
      if (current.phase === "session-held") {
        await this.acquireRefs(current, current.retainedGenerationRefs);
        continue;
      }
      await this.release(current.requestId);
    }
  }

  dependency(requestId: string): AgentTurnCustodyDependency | null {
    const entry = this.byRequest(requestId);
    if (!entry || entry.phase !== "active" || entry.requestReleasedAt !== null) {
      return null;
    }
    if (!entry.executionPlanDigest) {
      throw new Error("MCP execution plan 尚未 seal resolved config");
    }
    return {
      kind: "extension-plan" as const,
      planInstanceId: entry.planInstanceId,
      planDigest: entry.executionPlanDigest as `sha256:${string}`,
      componentPlanLeaseIds: [...entry.componentPlanLeaseIds],
    };
  }

  isActive(planInstanceId: string) {
    return this.file.snapshot().entries.some(
      (entry) => entry.planInstanceId === planInstanceId && entry.phase !== "released"
    );
  }

  snapshot() {
    return this.file.snapshot();
  }

  /** Active and release-pending plans retain exact component/generation refs. */
  requestIdsHoldingComponents(componentInstanceIdentities: ReadonlySet<string>) {
    return this.file
      .snapshot()
      .entries.filter(
        (entry) =>
          entry.requestReleasedAt === null &&
          entry.phase !== "released" &&
          entry.bindings.some((binding) =>
            componentInstanceIdentities.has(binding.sourceIdentity)
          )
      )
      .map((entry) => entry.requestId);
  }

  private byRequest(requestId: string) {
    return this.file.snapshot().entries.find(
      (entry) => entry.requestId === requestId && entry.phase !== "released"
    );
  }

  private async markReleasePending(requestId: string) {
    const entry = this.byRequest(requestId);
    if (!entry || entry.phase === "release-pending") return entry;
    return this.file.mutate((state) => {
      const current = state.entries.find(
        (item) => item.requestId === requestId && item.phase !== "released"
      );
      if (!current || current.phase !== entry.phase) {
        throw new Error("MCP plan ledger phase 已变化");
      }
      current.requestReleasedAt ??= Date.now();
      current.retainedGenerationRefs = activePlanSessionRefs(current);
      current.phase = "release-pending";
      current.revision += 1;
      state.revision += 1;
      return current;
    });
  }

  private advance(
    requestId: string,
    from: ThirdPartyMcpPlanEntry["phase"],
    to: ThirdPartyMcpPlanEntry["phase"]
  ) {
    return this.file.mutate((state) => {
      const entry = state.entries.find(
        (item) => item.requestId === requestId && item.phase !== "released"
      );
      if (!entry || entry.phase !== from) throw new Error("MCP plan ledger phase 已变化");
      entry.phase = to;
      entry.revision += 1;
      state.revision += 1;
      return entry;
    });
  }

  private compactReleased(requestId: string) {
    return this.file.mutate((state) => {
      const before = state.entries.length;
      state.entries = state.entries.filter(
        (entry) => entry.requestId !== requestId || entry.phase !== "released"
      );
      if (state.entries.length !== before) state.revision += 1;
    });
  }

  private async acquireAll(entry: ThirdPartyMcpPlanEntry) {
    await this.acquireRefs(
      entry,
      [...uniqueGenerationBindings(entry.bindings)].map(
        (binding) => binding.generationRef
      )
    );
  }

  private async releaseAll(entry: ThirdPartyMcpPlanEntry) {
    await this.releaseRefs(
      entry,
      [...uniqueGenerationBindings(entry.bindings)].map(
        (binding) => binding.generationRef
      )
    );
  }

  private async acquireRefs(
    entry: ThirdPartyMcpPlanEntry,
    refs: readonly ExtensionPackageGenerationRef[]
  ) {
    await this.refs!.acquireMany(refs, entry.owner);
  }

  private async releaseRefs(
    entry: ThirdPartyMcpPlanEntry,
    refs: readonly ExtensionPackageGenerationRef[]
  ) {
    await this.refs!.releaseMany(refs, entry.owner);
  }

  private assertMaterializedBinding(
    entry: ThirdPartyMcpPlanEntry,
    binding: ThirdPartyMcpPlanEntry["bindings"][number] | undefined,
    discovery: {
      deliveryInstanceId: string;
      planInstanceId: string;
      packageGenerationRef: ExtensionPackageGenerationRef;
      componentInstanceIdentity: string;
      deliveryIdentity: `sha256:${string}`;
    },
    input: {
      session: { backend: "codex" | "claude" | "kimi" | "opencode" };
      backendRuntimeIdentity: string;
      projectContext: { projectId: string | null; projectLifecycleRevision: number | null };
    }
  ) {
    if (
      discovery.planInstanceId !== entry.planInstanceId ||
      !entry.materializedDeliveryInstanceIds.includes(discovery.deliveryInstanceId) ||
      !binding ||
      binding.sourceIdentity !== discovery.componentInstanceIdentity ||
      refKey(binding.generationRef) !== refKey(discovery.packageGenerationRef) ||
      binding.backend !== input.session.backend ||
      binding.backendRuntimeIdentity !== input.backendRuntimeIdentity ||
      binding.deliveryIdentity !== discovery.deliveryIdentity ||
      entry.projectContext.projectId !== input.projectContext.projectId ||
      entry.projectContext.projectLifecycleRevision !==
        input.projectContext.projectLifecycleRevision
    ) {
      throw conflict("Extension discovery 不是已物化的 frozen App delivery");
    }
  }
}

function planBindings(plan: ComponentDeliveryPlan) {
  return plan.deliveries.map((delivery) => planBindingSchema.parse({
    deliveryInstanceId: delivery.deliveryInstanceId,
    sourceIdentity: delivery.componentInstanceIdentity,
    generationRef: structuredClone(delivery.packageGenerationRef),
    backend: plan.turnIdentity.backendId,
    backendRuntimeIdentity: plan.turnIdentity.backendRuntimeIdentity,
    deliveryIdentity: delivery.deliveryRef.entryDigest,
    componentPlanLeaseId: delivery.componentPlanLeaseId,
    resolvedConfigDigest: delivery.resolvedConfigDigest,
  }));
}

function uniqueGenerationBindings(bindings: readonly ThirdPartyMcpPlanBinding[]) {
  const unique = new Map<string, ThirdPartyMcpPlanBinding>();
  for (const binding of bindings) {
    const key = `${binding.generationRef.packageGenerationId}\0${binding.generationRef.recordDigest}`;
    if (!unique.has(key)) unique.set(key, binding);
  }
  return unique.values();
}

function refKey(ref: ExtensionPackageGenerationRef) {
  return `${ref.packageGenerationId}\0${ref.recordDigest}`;
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}
