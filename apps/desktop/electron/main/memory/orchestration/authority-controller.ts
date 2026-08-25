/**
 * [INPUT]: Depends on Policy Consent purpose, core capability fence, current Settings/target/provider, control of snapshot and capture proof
 * [OUTPUT]: Provides runtime destination→Consent convergence, valid Consent destination reading, and simultaneously testing the live/rebuild capability fence of the shared mode/generation/Space/peer
 * [POS]: The main/memory/orchestration is licensed to the fence and the final fence; MemoryService retains the facade and no longer focuses on configuring Consent and verification details
 */

import { randomUUID } from "node:crypto";
import type {
  MemoryEffectiveTarget,
  MemoryRuntimeConfigPreview,
} from "../../../../shared/memory-ipc";
import type { MemorySettings } from "../../../../shared/settings-ipc";
import type { TrustedProviderProof } from "./capture-controller";
import {
  expectedPeerId,
  memorySpaceId,
  type FrozenTurnMemoryContext,
  type MemoryPrePromptValidation,
  type MemoryScopeSubject,
} from "../core/domain";
import type { MemoryProvider } from "../core/provider";
import { memoryCapabilityFenceMatches } from "../core/capability-fence";
import type { MemoryPolicyStore } from "../policy/store";
import { frozenContextMatches } from "../prompt-lane";

/** 冻结 context 的 Space 反推 subject，按当前 Policy generation 重算 live Space。 */
function liveSpaceIdFor(
  policy: MemoryPolicyStore,
  context: FrozenTurnMemoryContext
) {
  const space = context.memorySpace;
  const subject: MemoryScopeSubject =
    space.kind === "project"
      ? { kind: "project", projectId: space.projectId }
      : space.kind === "chat"
        ? {
            kind: "chat",
            chatId: space.chatId,
            incarnationId: space.incarnationId,
          }
        : space.kind === "standalone"
          ? { kind: "standalone", scopeOwnerId: space.scopeOwnerId }
          : { kind: "personal", scopeOwnerId: space.scopeOwnerId };
  return memorySpaceId(policy.spaceFor(subject));
}

type ActiveState = Readonly<{
  memory: MemorySettings | null;
  target: MemoryEffectiveTarget | null;
  provider: MemoryProvider | null;
  controlGeneration: number;
}>;

export async function reconcileRuntimeDestination(
  dependencies: {
    policy: MemoryPolicyStore;
    initializeOwners(): Promise<void>;
    active(): ActiveState;
    changed(): void;
    publish(): void;
  },
  preview: MemoryRuntimeConfigPreview,
  confirmed: boolean
) {
  await dependencies.initializeOwners();
  const { memory, target } = dependencies.active();
  if (
    !memory?.enabled ||
    memory.provider !== preview.providerId ||
    target?.providerDataInstanceId !== preview.providerDataInstanceId
  ) throw new Error("Memory 活跃目标已变化，拒绝沿用配置授权");
  if (preview.change === "none") return;
  if (
    (preview.change === "hostname" ||
      preview.change === "hostname-and-model") &&
    !confirmed
  ) {
    throw new Error("提取 hostname 变化缺少用户确认");
  }
  const snapshot = dependencies.policy.snapshot();
  const current = dependencies.policy.currentConsent(snapshot);
  if (
    !current ||
    current.providerId !== preview.providerId ||
    current.providerDataInstanceId !== preview.providerDataInstanceId ||
    current.extractionHostname !== preview.currentHostname ||
    current.extractionModel !== preview.currentModel
  ) throw new Error("Memory 当前 Consent 与配置预览不一致，请重新确认");
  await dependencies.policy.createConsent({
    operationId: `runtime-config:${randomUUID()}`,
    providerDataInstanceId: preview.providerDataInstanceId,
    providerId: preview.providerId,
    extractionHostname: preview.nextHostname,
    extractionModel: preview.nextModel,
    sharingMode: memory.sharingMode,
    effectiveAt: Date.now(),
    silent: preview.change === "model",
    purpose:
      memory.paused || snapshot.state.pausedAt !== null
        ? "configuration"
        : "live",
  });
  dependencies.changed();
  dependencies.publish();
}

export function effectiveConsentDestination(
  policy: MemoryPolicyStore,
  providerId: string,
  providerDataInstanceId: string
) {
  const consent = policy.currentConsent();
  if (
    !consent ||
    consent.providerId !== providerId ||
    consent.providerDataInstanceId !== providerDataInstanceId
  ) return null;
  return {
    hostname: consent.extractionHostname,
    model: consent.extractionModel,
  };
}

export function validateFrozenAuthority(
  dependencies: {
    policy: MemoryPolicyStore;
    active(): ActiveState;
    executionEnabled(): boolean;
    rebuildActive(): boolean;
  },
  context: FrozenTurnMemoryContext,
  proof?: TrustedProviderProof,
  rebuild = false
) {
  const policy = dependencies.policy.snapshot();
  /* rebuild capture 的授权按 context 携带的 job Epoch 直查——job Epoch
     不占 admission 槽位，live 槽位随暂停/恢复轮换不得使 job 失效。 */
  const rebuildEpoch = rebuild
    ? policy.state.consentEpochs[context.consentEpochId]
    : undefined;
  const consent = rebuild
    ? rebuildEpoch?.revokedAt === null && rebuildEpoch.purpose === "rebuild"
      ? rebuildEpoch
      : null
    : dependencies.policy.activeConsent(policy);
  const active = dependencies.active();
  const liveSpaceId = liveSpaceIdFor(dependencies.policy, context);
  const sharingMatches = Boolean(
    consent?.sharingMode === context.sharingMode &&
      consent.sharingGeneration === context.sharingGeneration &&
      policy.state.sharingGeneration === context.sharingGeneration &&
      active.memory?.sharingMode === context.sharingMode
  );
  const shared = memoryCapabilityFenceMatches(
    context,
    {
      policyRevision: policy.state.revision,
      revocationRevision: policy.state.revocationRevision,
      consentEpochId: consent?.id ?? null,
      providerDataInstanceId:
        active.target?.providerDataInstanceId ?? null,
      memorySpaceId: liveSpaceId,
      expectedPeerId: expectedPeerId(liveSpaceId),
      runtimeGeneration: active.controlGeneration,
    },
    { requireRuntimeGeneration: !rebuild }
  );
  if (rebuild) {
    return Boolean(
      dependencies.rebuildActive() &&
        !policy.state.tombstones[context.sourceSessionKey] &&
        sharingMatches &&
        shared &&
        proofMatches(proof, active, context, policy.state.revision)
    );
  }
  return Boolean(
    dependencies.executionEnabled() &&
      sharingMatches &&
      shared &&
      proofMatches(proof, active, context, policy.state.revision, true)
  );
}

export function validateCurrentContext(
  policy: MemoryPolicyStore,
  context: FrozenTurnMemoryContext,
  active: ActiveState,
  accepting: boolean
): MemoryPrePromptValidation {
  const snapshot = policy.snapshot();
  const liveSpaceId = liveSpaceIdFor(policy, context);
  const consent = policy.activeConsent(snapshot);
  const sharingMatches = Boolean(
    consent?.sharingMode === context.sharingMode &&
      consent.sharingGeneration === context.sharingGeneration &&
      snapshot.state.sharingGeneration === context.sharingGeneration &&
      active.memory?.sharingMode === context.sharingMode
  );
  return frozenContextMatches(context, {
    enabled: Boolean(active.memory?.enabled && sharingMatches),
    accepting,
    paused: Boolean(
      active.memory?.paused || snapshot.state.pausedAt !== null
    ),
    policyRevision: snapshot.state.revision,
    revocationRevision: snapshot.state.revocationRevision,
    consentEpochId: consent?.id ?? null,
    providerDataInstanceId: active.target?.providerDataInstanceId ?? null,
    memorySpaceId: liveSpaceId,
    expectedPeerId: expectedPeerId(liveSpaceId),
    runtimeGeneration: active.controlGeneration,
  });
}

function proofMatches(
  proof: TrustedProviderProof | undefined,
  active: ActiveState,
  context: FrozenTurnMemoryContext,
  policyRevision: number,
  requireGeneration = false
) {
  return Boolean(
    !proof ||
      ((!requireGeneration || proof.controlGeneration === active.controlGeneration) &&
        proof.provider === active.provider &&
        proof.providerDataInstanceId === context.providerDataInstanceId &&
        proof.policyRevision === policyRevision &&
        proof.revocationRevision === context.revocationRevision)
  );
}
