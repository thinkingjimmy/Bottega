/**
 * [INPUT]: Depends on immutable Settings/Policy/Runtime snapshot, canonical Chat snapshot, core Scope resolver/domain and realpath
 * [OUTPUT]: Provides a single fail-open MemoryTurnAdmissionPort façade, revision-fenced eligible/skipped/unavailable and a fully frozen optional observation domain by active consent; no admission at all (the turn goes without Memory) until Memory's startup has run
 * [POS]: The main/memory/policy boundary; Just read Owner, take a snapshot, don't search, don't connect, don't write Store
 * Workflow reads require explicit intent, local opt-in and non-personal consent; freshness comes from step admission time.
 */

import { realpath } from "node:fs/promises";
import type {
  MemoryFailureKind,
  MemoryObservationScope,
} from "../../../../shared/ipc/content/memory-ipc";
import type { MemorySharingMode } from "../../../../shared/ipc/settings/settings-ipc";
import {
  expectedPeerId,
  freezeMemoryValue,
  sourceSessionKey,
  type FrozenTurnMemoryAdmission,
} from "../core/domain";
import {
  resolveMemoryScopeSubject,
  resolvedMemorySpace,
} from "../core/memory-scope";
import type {
  ConsentEpoch,
  MemoryPolicyStore,
  PublishedPolicySnapshot,
} from "./store";

export type MemoryIntentSnapshot = Readonly<{
  revision: number;
  enabled: boolean;
  paused: boolean;
  sharingMode: MemorySharingMode;
  workflow?: Readonly<{ enabled: boolean; generation: number }>;
}>;

export type MemoryRuntimeAdmissionSnapshot = Readonly<{
  revision: number;
  configured: boolean;
  providerDataInstanceId: string;
  providerId: string;
  generation: number;
}>;

export type CanonicalMemoryTurnSnapshot = Readonly<{
  requestId: string;
  planMode: boolean;
  chatId: string;
  incarnationId: string;
  projectId: string | null;
  workspace: string;
} & ({ origin: "manual" | "other"; userCreatedAt: number } |
  { origin: "workflow"; admittedAt: number; workflowMemoryRead: boolean })>;

export type MemoryAdmissionAttention = Readonly<{
  failureKind: MemoryFailureKind;
  at: number;
}>;

export class MemoryTurnAdmissionPort {
  constructor(
    private readonly options: {
      policy: MemoryPolicyStore;
      intent(): MemoryIntentSnapshot;
      runtime(): MemoryRuntimeAdmissionSnapshot;
      ownerFailure?(): MemoryFailureKind | null;
      /** False until Memory's startup has run (it waits for startup recovery). */
      started?(): boolean;
      attention?(value: MemoryAdmissionAttention): void;
    }
  ) {}

  async prepare(
    canonical: CanonicalMemoryTurnSnapshot
  ): Promise<FrozenTurnMemoryAdmission | null> {
    if (canonical.origin === "other") return null;
    /* A turn released before Memory's startup ran goes without Memory: never a recall that calls the provider and then fails. */
    if (this.options.started && !this.options.started()) return null;
    try {
      const ownerFailure = this.options.ownerFailure?.();
      if (ownerFailure) {
        return this.unavailable(canonical, ownerFailure);
      }
      const workspaceRealpath = await realpath(canonical.workspace);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const intent = this.options.intent();
        if (canonical.origin === "workflow" && (!canonical.workflowMemoryRead || !intent.workflow?.enabled || intent.sharingMode === "personal")) {
          return this.skipped(canonical, "workflow-not-allowed");
        }
        if (!intent.enabled) return this.skipped(canonical, "disabled");
        if (intent.paused) return this.skipped(canonical, "paused");
        if (canonical.planMode) return this.skipped(canonical, "plan-mode");
        const policy = this.options.policy.snapshot();
        if (!policy.initialized) {
          return this.unavailable(canonical, "policy-store");
        }
        const runtime = this.options.runtime();
        if (!runtime.configured || !runtime.providerDataInstanceId) {
          return this.unavailable(canonical, "runtime-configuration");
        }
        const consent = this.options.policy.activeConsent(policy);
        if (!consent) {
          return policy.state.pausedAt === null
            ? this.skipped(canonical, "disabled")
            : this.skipped(canonical, "paused");
        }
        if (
          consent.providerDataInstanceId !== runtime.providerDataInstanceId ||
          consent.providerId !== runtime.providerId ||
          consent.sharingMode !== intent.sharingMode ||
          consent.sharingGeneration !== policy.state.sharingGeneration
        ) {
          return this.unavailable(
            canonical,
            "runtime-configuration",
            observationScopeOf(consent)
          );
        }
        const admittedAt = canonical.origin === "workflow" ? canonical.admittedAt : canonical.userCreatedAt;
        if (!Number.isFinite(admittedAt) || admittedAt < consent.effectiveAt) {
          return this.unavailable(
            canonical,
            "stale-capability",
            observationScopeOf(consent)
          );
        }
        if (!this.snapshotsStable(intent, policy, runtime)) continue;
        const subject = resolveMemoryScopeSubject(
          canonical,
          consent.sharingMode,
          policy.state.scopeOwnerId
        );
        const resolved = resolvedMemorySpace(
          subject,
          this.options.policy.generationFor(subject, policy),
          consent.sharingGeneration
        );
        if (expectedPeerId(resolved.memorySpaceId) !== resolved.expectedPeerId) {
          return this.unavailable(canonical, "scope-resolution");
        }
        return freezeMemoryValue({
          kind: "eligible" as const,
          context: {
            requestId: canonical.requestId,
            ...(canonical.origin === "workflow" ? { workflowGeneration: intent.workflow!.generation } : {}),
            sharingMode: consent.sharingMode,
            sharingGeneration: consent.sharingGeneration,
            memorySpace: resolved.memorySpace,
            memorySpaceId: resolved.memorySpaceId,
            sourceSessionKey: sourceSessionKey(canonical),
            workspaceRealpath,
            policyRevision: policy.state.revision,
            consentEpochId: consent.id,
            providerDataInstanceId: runtime.providerDataInstanceId,
            expectedPeerId: resolved.expectedPeerId,
            revocationRevision: policy.state.revocationRevision,
            runtimeGeneration: runtime.generation,
          },
        });
      }
      return this.unavailable(canonical, "initialization");
    } catch {
      return this.unavailable(canonical, "scope-resolution");
    }
  }

  private snapshotsStable(
    intent: MemoryIntentSnapshot,
    policy: PublishedPolicySnapshot,
    runtime: MemoryRuntimeAdmissionSnapshot
  ) {
    return (
      this.options.intent().revision === intent.revision &&
      this.options.intent().workflow?.generation === intent.workflow?.generation &&
      this.options.intent().workflow?.enabled === intent.workflow?.enabled &&
      this.options.policy.snapshot().state.revision === policy.state.revision &&
      this.options.runtime().revision === runtime.revision
    );
  }

  private skipped(
    canonical: CanonicalMemoryTurnSnapshot,
    reason: "disabled" | "paused" | "plan-mode" | "workflow-not-allowed"
  ) {
    return freezeMemoryValue({
      kind: "skipped" as const,
      requestId: canonical.requestId,
      reason,
    });
  }

  /* scope 只由「consent 已在手」的失败点传入：那里的三元与本次判定同源，
     再读一遍快照等于把结论绑死在调用栈的同步性上。ownerFailure、runtime 尚未
     配置与 catch 兜底三条路径根本没读到 consent，只能退回快照补一次观测。 */
  private unavailable(
    canonical: CanonicalMemoryTurnSnapshot,
    failureKind: MemoryFailureKind,
    scope?: MemoryObservationScope
  ) {
    const observationScope = scope ?? this.observationScope(failureKind);
    try {
      this.options.attention?.({ failureKind, at: Date.now() });
    } catch {
      /* 观测端口不属于准入判定；记录失败不得击穿 Chat 主链。 */
    }
    return freezeMemoryValue({
      kind: "unavailable" as const,
      requestId: canonical.requestId,
      failureKind,
      ...(observationScope ? { observationScope } : {}),
    });
  }

  private observationScope(
    failureKind: MemoryFailureKind
  ): MemoryObservationScope | null {
    if (failureKind === "policy-store" || failureKind === "initialization") {
      return null;
    }
    try {
      const policy = this.options.policy.snapshot();
      const consent = this.options.policy.activeConsent(policy);
      if (!policy.initialized || !consent) {
        return null;
      }
      return observationScopeOf(consent);
    } catch {
      return null;
    }
  }
}

const observationScopeOf = (
  consent: ConsentEpoch
): MemoryObservationScope => ({
  providerDataInstanceId: consent.providerDataInstanceId,
  sharingMode: consent.sharingMode,
  sharingGeneration: consent.sharingGeneration,
});
