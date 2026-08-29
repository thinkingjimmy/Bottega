/**
 * [INPUT]: Depends on shared generation build closed operation/checkpoint with BaseGuiGrantStore durable exact decision/revoke
 * [OUTPUT]: Provides BaseGuiBuildParticipant; prepare freeze exact decision, finalize phase review, abort write generation revoke tombstone
 * [POS]: apps/base-gui build participant; it records authorized GUI build state and returns a checkpoint without owning AppStore phase or pointers
 */

import type {
  AppGenerationBuildCheckpoint,
  AppGenerationBuildOperation,
} from "../../../../shared/app-lifecycle";
import type { BaseGuiGrantStore } from "./grant-store";

export class BaseGuiBuildParticipant {
  constructor(private readonly grants: BaseGuiGrantStore) {}

  async prepare(
    operation: AppGenerationBuildOperation
  ): Promise<AppGenerationBuildCheckpoint> {
    const request = operation.baseGuiCapabilityRequest;
    if (!request) return attention(operation, "build 无 Base GUI capability 请求");
    const decision = await this.grants.createDecision({
      appId: operation.appId,
      generationId: operation.appGenerationId,
      contentDigest: request.contentDigest,
      expectedActiveGenerationId: operation.expectedActiveGenerationId,
      requestedCapabilities: request.requestedCapabilities,
      requestedHostActions: request.requestedHostActions,
      requestedCapabilityScopes: request.requestedCapabilityScopes,
    });
    return exact(operation, decision)
      ? { kind: "base-gui", operationId: decision.decisionId, state: "prepared" }
      : attention(operation, "durable decision 与 frozen build 请求不一致");
  }

  async finalize(
    operation: AppGenerationBuildOperation
  ): Promise<AppGenerationBuildCheckpoint> {
    const checkpoint = operation.checkpoints.find(
      (item) => item.kind === "base-gui"
    );
    const decision = checkpoint
      ? this.grants.decision(checkpoint.operationId)
      : null;
    return decision && exact(operation, decision)
      ? { kind: "base-gui", operationId: decision.decisionId, state: "committed" }
      : attention(operation, "sealed generation 的 Base GUI decision 不存在或已漂移");
  }

  async abort(
    operation: AppGenerationBuildOperation
  ): Promise<AppGenerationBuildCheckpoint> {
    await this.grants.revoke(operation.appId, operation.appGenerationId);
    const decision = operation.checkpoints.find(
      (item) => item.kind === "base-gui"
    );
    return {
      kind: "base-gui",
      operationId:
        decision?.operationId ?? `base-gui:${operation.generationBuildId}`,
      state: "aborted",
    };
  }
}

function exact(
  operation: AppGenerationBuildOperation,
  decision: NonNullable<ReturnType<BaseGuiGrantStore["decision"]>>
) {
  const request = operation.baseGuiCapabilityRequest;
  return Boolean(
    request &&
      decision.appId === operation.appId &&
      decision.generationId === operation.appGenerationId &&
      decision.contentDigest === request.contentDigest &&
      decision.expectedActiveGenerationId === operation.expectedActiveGenerationId &&
      sameSet(decision.requestedCapabilities, request.requestedCapabilities) &&
      sameSet(decision.requestedHostActions, request.requestedHostActions) &&
      decision.requestedCapabilityScopes.workspaceRead ===
        request.requestedCapabilityScopes.workspaceRead
  );
}

function sameSet(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function attention(
  operation: AppGenerationBuildOperation,
  reason: string
): AppGenerationBuildCheckpoint {
  console.warn(
    `[base-gui] build ${operation.generationBuildId} needs-attention：${reason}`
  );
  return {
    kind: "base-gui",
    operationId: `base-gui:${operation.generationBuildId}`,
    state: "needs-attention",
  };
}
