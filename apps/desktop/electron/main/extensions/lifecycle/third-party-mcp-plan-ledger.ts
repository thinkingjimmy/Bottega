/**
 * [INPUT]: Depends on durable-json, ComponentDeliveryPlan, the execution config digest after the materialization and the Registry generation-ref narrow ports
 * [OUTPUT]: Provides ThirdPartyMcpPlanLedger: intent-before-ref, resolved-config seal, active/release-pending single-mode ledger, crash reconcile with custody digest Truth
 * [POS]: The third-party MCP/component plan for extensions/lifecycle single-writer; AppsService only contributes plan binding, no longer holding memory reference truth
 */

import { join } from "node:path";
import { z } from "zod";
import type {
  ComponentDeliveryPlan,
  ExtensionPackageGenerationRef,
} from "../../../../shared/extensions-ipc";
import type { AgentTurnCustodyDependency } from "../../../../shared/app-lifecycle";
import { DurableJson } from "../../persistence/durable-json";
import { digestCanonical } from "../registry-store";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const refSchema = z.object({
  packageGenerationId: z.string().min(1),
  recordDigest: digest,
}).strict();
const bindingSchema = z.object({
  deliveryInstanceId: z.string().min(1),
  sourceIdentity: z.string().min(1),
  generationRef: refSchema,
  componentPlanLeaseId: z.string().min(1),
  resolvedConfigDigest: digest,
}).strict();
const entrySchema = z.object({
  requestId: z.string().min(1),
  planInstanceId: z.string().min(1),
  owner: z.string().regex(/^plan:[A-Za-z0-9._:-]+$/),
  componentPlanLeaseIds: z.array(z.string().min(1)),
  bindings: z.array(bindingSchema),
  sourcePlanDigest: digest,
  executionPlanDigest: digest.nullable(),
  resolvedMcpDeliveryInstanceIds: z.array(z.string().min(1)),
  phase: z.enum(["preparing", "active", "release-pending", "released"]),
  revision: z.number().int().nonnegative(),
}).strict();
const fileSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  entries: z.array(entrySchema),
}).strict();

type File = z.infer<typeof fileSchema>;
type Entry = File["entries"][number];

export type GenerationRefPort = Readonly<{
  acquire(ref: ExtensionPackageGenerationRef, owner: string): Promise<unknown>;
  release(ref: ExtensionPackageGenerationRef, owner: string): Promise<unknown>;
}>;

export class ThirdPartyMcpPlanLedger {
  private readonly file: DurableJson<File>;
  private refs: GenerationRefPort | null = null;

  constructor(userData: string) {
    this.file = new DurableJson(
      join(userData, "agent-extensions", "third-party-mcp-plans.json"),
      fileSchema,
      () => ({ schemaVersion: 1, revision: 0, entries: [] })
    );
  }

  initialize() {
    return this.file.initialize();
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
      state.entries.push(entrySchema.parse({
        requestId,
        planInstanceId: plan.planInstanceId,
        owner: `plan:${plan.planInstanceId}`,
        componentPlanLeaseIds: plan.deliveries.map((item) => item.componentPlanLeaseId),
        bindings,
        sourcePlanDigest: plan.planDigest,
        executionPlanDigest: null,
        resolvedMcpDeliveryInstanceIds: [],
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
        binding.resolvedConfigDigest = digest.parse(resolution.resolvedConfigDigest);
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

  /** 可在 Registry 尚未初始化时调用；真正 release 留给随后一次 reconcile。 */
  async release(requestId: string) {
    const entry = this.byRequest(requestId);
    if (!entry || entry.phase === "released") return;
    await this.markReleasePending(requestId);
    if (!this.refs) return;
    await this.releaseAll(this.byRequest(requestId)!);
    await this.advance(requestId, "release-pending", "released");
  }

  /**
   * startup custody 已先给出仍活的 request。其余 preparing/active 都是
   * intent-before-custody 崩溃残片，必须释放；quarantine 则重新宣告全部 ref。
   */
  async reconcile(activeRequestIds: ReadonlySet<string>) {
    if (!this.refs) throw new Error("ThirdPartyMcpPlanLedger 尚未连接 Registry");
    for (const current of this.file.snapshot().entries) {
      if (current.phase === "released") continue;
      if (activeRequestIds.has(current.requestId) && current.phase !== "release-pending") {
        await this.acquireAll(current);
        if (current.phase === "preparing") {
          await this.advance(current.requestId, "preparing", "active");
        }
        continue;
      }
      await this.release(current.requestId);
    }
  }

  dependency(requestId: string): AgentTurnCustodyDependency | null {
    const entry = this.byRequest(requestId);
    if (!entry || entry.phase === "released") return null;
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

  private byRequest(requestId: string) {
    return this.file.snapshot().entries.find(
      (entry) => entry.requestId === requestId && entry.phase !== "released"
    );
  }

  private async markReleasePending(requestId: string) {
    const entry = this.byRequest(requestId);
    if (!entry || entry.phase === "release-pending") return entry;
    return this.advance(requestId, entry.phase, "release-pending");
  }

  private advance(requestId: string, from: Entry["phase"], to: Entry["phase"]) {
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

  private async acquireAll(entry: Entry) {
    for (const binding of uniqueGenerationBindings(entry.bindings)) {
      await this.refs!.acquire(binding.generationRef as ExtensionPackageGenerationRef, entry.owner);
    }
  }

  private async releaseAll(entry: Entry) {
    for (const binding of uniqueGenerationBindings(entry.bindings)) {
      await this.refs!.release(binding.generationRef as ExtensionPackageGenerationRef, entry.owner);
    }
  }
}

function planBindings(plan: ComponentDeliveryPlan) {
  return plan.deliveries.map((delivery) => bindingSchema.parse({
    deliveryInstanceId: delivery.deliveryInstanceId,
    sourceIdentity: delivery.componentIdentity,
    generationRef: structuredClone(delivery.packageGenerationRef),
    componentPlanLeaseId: delivery.componentPlanLeaseId,
    resolvedConfigDigest: delivery.resolvedConfigDigest,
  }));
}

function uniqueGenerationBindings(bindings: readonly z.infer<typeof bindingSchema>[]) {
  const unique = new Map<string, z.infer<typeof bindingSchema>>();
  for (const binding of bindings) {
    const key = `${binding.generationRef.packageGenerationId}\0${binding.generationRef.recordDigest}`;
    if (!unique.has(key)) unique.set(key, binding);
  }
  return unique.values();
}
