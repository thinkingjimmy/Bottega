/**
 * [INPUT]: Depends on the Policy store, Delivery store, active target/provider/controlGeneration state, the managed runtime registry, and a health-refresh callback
 * [OUTPUT]: Provides MemoryAuthorityGuard: trustedProviderReady (health-gated proof for a frozen turn), validateFrozen/validateContext capability checks, an identity verifier, and executionEnabled
 * [POS]: The authorization guard of main/memory/service/support; centralizes identity, capability, and execution-gate checks so MemoryService's façade doesn't duplicate this security logic
 */

import type {
  MemoryEffectiveTarget,
  MemoryStatusSnapshot,
} from "../../../../../shared/ipc/content/memory-ipc";
import type { MemorySettings } from "../../../../../shared/ipc/settings/settings-ipc";
import {
  validateCurrentContext,
  validateFrozenAuthority,
} from "../../orchestration/authority-controller";
import type { TrustedProviderProof } from "../../orchestration/capture-controller";
import type { FrozenTurnMemoryContext } from "../../core/domain";
import type { MemoryProvider } from "../../core/provider";
import type { MemoryDeliveryStore } from "../../delivery/store";
import type { MemoryPolicyStore } from "../../policy/store";
import type { ManagedRuntimeRegistry } from "../../runtime/managed-registry";
import { raceMemoryDeadline } from "../../turn-deadline";

type MemoryAuthorityState = Readonly<{
  memory: MemorySettings | null;
  target: MemoryEffectiveTarget | null;
  provider: MemoryProvider | null;
  controlGeneration: number;
}>;

type MemoryAuthorityDependencies = Readonly<{
  policy: MemoryPolicyStore;
  delivery: MemoryDeliveryStore;
  runtimes: ManagedRuntimeRegistry;
  active(): MemoryAuthorityState;
  workflowRolesEnabled?(): boolean;
  accepting(): boolean;
  ownersAvailable(): boolean;
  rebuildActive(): boolean;
  rebuildBlocked(providerId: string): boolean;
  refreshHealth(rebuild: boolean): Promise<MemoryStatusSnapshot>;
}>;

export class MemoryAuthorityGuard {
  private workflowGeneration = 0;
  constructor(private readonly dependencies: MemoryAuthorityDependencies) {}

  workflowSnapshot() {
    return { enabled: this.dependencies.workflowRolesEnabled?.() ?? false, generation: this.workflowGeneration };
  }

  invalidateWorkflowRoles() { this.workflowGeneration += 1; }

  private workflowAllowed(context: FrozenTurnMemoryContext) {
    return context.workflowGeneration === undefined || (this.workflowSnapshot().enabled &&
      context.workflowGeneration === this.workflowGeneration && context.sharingMode !== "personal");
  }

  snapshot() {
    return this.dependencies.active();
  }

  async trustedProviderReady(
    context: FrozenTurnMemoryContext,
    signal: AbortSignal,
    deadlineAt: number,
    rebuild = false
  ): Promise<TrustedProviderProof> {
    if (!this.workflowAllowed(context)) throw new Error("memory-workflow-authority-revoked");
    const active = this.snapshot();
    if (!active.provider) throw new Error("Memory provider 不可用");
    const status = await raceMemoryDeadline(
      this.dependencies.refreshHealth(rebuild),
      signal,
      deadlineAt
    );
    if (status.health !== "ready" && status.health !== "compat") {
      throw new Error("Memory provider 未通过正向身份门");
    }
    const policy = this.dependencies.policy.snapshot();
    const proof = Object.freeze({
      controlGeneration: active.controlGeneration,
      provider: active.provider,
      providerDataInstanceId: context.providerDataInstanceId,
      policyRevision: policy.state.revision,
      revocationRevision: policy.state.revocationRevision,
    });
    if (!this.validateFrozen(context, proof, rebuild)) {
      throw new Error("Memory capability 已撤销");
    }
    return proof;
  }

  validateFrozen(
    context: FrozenTurnMemoryContext,
    proof?: TrustedProviderProof,
    rebuild = false
  ) {
    return this.workflowAllowed(context) && validateFrozenAuthority(
      {
        policy: this.dependencies.policy,
        active: () => this.snapshot(),
        executionEnabled: () => this.executionEnabled(),
        rebuildActive: () => this.dependencies.rebuildActive(),
      },
      context,
      proof,
      rebuild
    );
  }

  validateContext(context: FrozenTurnMemoryContext) {
    if (!this.workflowAllowed(context)) return { kind: "unavailable" as const, failureKind: "stale-capability" as const };
    return validateCurrentContext(
      this.dependencies.policy,
      context,
      this.snapshot(),
      this.dependencies.accepting()
    );
  }

  identityVerifier() {
    const target = this.snapshot().target;
    if (!target?.managed) return null;
    const coordinator = this.dependencies.runtimes.get(target.providerId);
    return coordinator
      ? () => coordinator.isOwnedServiceLive(target.baseUrl)
      : null;
  }

  executionEnabled() {
    const { memory, provider, target } = this.snapshot();
    const instanceId = target?.providerDataInstanceId;
    const instance = instanceId
      ? this.dependencies.delivery.snapshot().providerInstances[instanceId]
      : null;
    return Boolean(
      this.dependencies.accepting() &&
        this.dependencies.ownersAvailable() &&
        memory?.enabled &&
        !memory.paused &&
        this.dependencies.policy.activeConsent() &&
        provider &&
        target &&
        !this.dependencies.rebuildBlocked(target.providerId) &&
        instanceId &&
        !instance?.quiesced &&
        !this.dependencies.delivery.activationCleanupOperation(instanceId)
    );
  }
}
