/**
 * [INPUT]: Depends on immutable Settings/Policy/Runtime snapshot, canonical Chat snapshot, core Scope resolver/domain and realpath
 * [OUTPUT]: Provides a single fail-open MemoryTurnAdmissionPort façade, revision-fenced eligible/skipped/unavailable and a fully frozen optional observation domain by active consent
 * [POS]: The main/memory/policy boundary; Just read Owner, take a snapshot, don't search, don't connect, don't write Store
 */

import { realpath } from "node:fs/promises";
import type {
  MemoryFailureKind,
  MemoryObservationScope,
} from "../../../../shared/memory-ipc";
import type { MemorySharingMode } from "../../../../shared/settings-ipc";
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
  origin: "manual" | "other";
  planMode: boolean;
  chatId: string;
  incarnationId: string;
  projectId: string | null;
  userCreatedAt: number;
  workspace: string;
}>;

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
      attention?(value: MemoryAdmissionAttention): void;
    }
  ) {}

  async prepare(
    canonical: CanonicalMemoryTurnSnapshot
  ): Promise<FrozenTurnMemoryAdmission | null> {
    if (canonical.origin !== "manual") return null;
    try {
      const ownerFailure = this.options.ownerFailure?.();
      if (ownerFailure) {
        return this.unavailable(canonical, ownerFailure);
      }
      const workspaceRealpath = await realpath(canonical.workspace);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const intent = this.options.intent();
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
        if (canonical.userCreatedAt < consent.effectiveAt) {
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
      this.options.policy.snapshot().state.revision === policy.state.revision &&
      this.options.runtime().revision === runtime.revision
    );
  }

  private skipped(
    canonical: CanonicalMemoryTurnSnapshot,
    reason: "disabled" | "paused" | "plan-mode"
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
