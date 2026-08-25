/**
 * [INPUT]: Depends on Policy Current sharing mode/generation/tombstone, Delivery reservation/target inventory with only MemorySpaceGate
 * [OUTPUT]: Provides the Chat deletion effect of the current real shared Space, and Project re-link generation-first clearance of the group-only mode
 * [POS]: The main/memory/orchestration destructive effect controller; The network is always waiting outside the gate, and the Service is only responsible for lifecycle assignments
 */

import type { ChatRecord } from "../../../../shared/chats-ipc";
import { memorySpaceId, sourceSessionKey } from "../core/domain";
import { resolveMemoryScopeSubject } from "../core/memory-scope";
import type { MemoryDeliveryStore } from "../delivery/store";
import type { MemoryCleanupRunner } from "../delivery/cleanup-runner";
import type { MemoryPolicyStore } from "../policy/store";
import { memorySpaceGate } from "../space-gate";

type Dependencies = {
  policy: MemoryPolicyStore;
  delivery: MemoryDeliveryStore;
  cleanup: MemoryCleanupRunner;
  initializeOwners(): Promise<void>;
  ownerAvailable(): boolean;
  hasMemoryHistory(): boolean;
  revoked(): void;
};

export type MemoryChatDeletionIntent = Readonly<{
  operationId: string;
  sourceSessionKey: string;
  memorySpaceId: string;
}>;

export class MemoryDestructiveController {
  constructor(private readonly dependencies: Dependencies) {}

  async snapshotProjectRebind(projectId: string) {
    if (!this.dependencies.hasMemoryHistory()) return null;
    await this.dependencies.initializeOwners();
    if (!this.dependencies.ownerAvailable()) {
      throw new Error("Memory Policy 不可用，拒绝改绑 Project");
    }
    if (this.dependencies.policy.currentConsent()?.sharingMode !== "group") {
      return null;
    }
    const subject = { kind: "project" as const, projectId };
    const generation = this.dependencies.policy.generationSnapshot(subject);
    return {
      expectedOldMemorySpaceId: memorySpaceId(
        this.dependencies.policy.spaceFor(subject)
      ),
      expectedSpaceGenerationRevision: generation.revision,
    };
  }


  async snapshotChatDeletion(
    chat: Pick<ChatRecord, "id" | "incarnationId"> &
      Partial<Pick<ChatRecord, "projectId">>,
    operationId: string
  ): Promise<MemoryChatDeletionIntent> {
    await this.dependencies.initializeOwners();
    if (!this.dependencies.ownerAvailable()) {
      throw new Error("Memory Policy 不可用，删除保持待完成");
    }
    const source = sourceSessionKey({ chatId: chat.id, incarnationId: chat.incarnationId });
    const policy = this.dependencies.policy.snapshot();
    const sharingMode =
      this.dependencies.policy.currentConsent(policy)?.sharingMode ?? "chat";
    const subject = resolveMemoryScopeSubject(
      {
        chatId: chat.id,
        incarnationId: chat.incarnationId,
        projectId: chat.projectId ?? null,
      },
      sharingMode,
      policy.state.scopeOwnerId
    );
    const spaceId = memorySpaceId(
      this.dependencies.policy.spaceFor(subject, policy)
    );
    return Object.freeze({
      operationId,
      sourceSessionKey: source,
      memorySpaceId: spaceId,
    });
  }

  async applyChatTombstone(intent: MemoryChatDeletionIntent) {
    const receipt = await memorySpaceGate.run(intent.memorySpaceId, () =>
      this.dependencies.policy.tombstone({
        operationId: `${intent.operationId}:policy`,
        sourceSessionKey: intent.sourceSessionKey,
        memorySpaceId: intent.memorySpaceId,
      })
    );
    this.dependencies.revoked();
    return receipt;
  }

  drainChatDeletion(intent: MemoryChatDeletionIntent) {
    return this.dependencies.delivery.drain(
      intent.memorySpaceId,
      intent.sourceSessionKey
    );
  }

  async applyChatCleanup(intent: MemoryChatDeletionIntent) {
    const receipts = [];
    for (const instance of Object.values(
      this.dependencies.delivery.snapshot().providerInstances
    )) {
      receipts.push(await memorySpaceGate.run(intent.memorySpaceId, () =>
        this.dependencies.delivery.cleanup({
          operationId: `${intent.operationId}:delivery:${instance.id}`,
          providerDataInstanceId: instance.id,
          providerId: instance.providerId,
          memorySpaceId: intent.memorySpaceId,
          sourceSessionKey: intent.sourceSessionKey,
          reason: "tombstone",
        })
      ));
      const request = this.dependencies.delivery.cleanupRequestForOperation(
        instance.id,
        `${intent.operationId}:delivery:${instance.id}`
      );
      if (request) {
        const completion = await this.dependencies.cleanup.drive(
          instance.id,
          request.id
        );
        if (completion) receipts.push(completion);
      }
    }
    return receipts;
  }

  verifyChatDeletionReceipts(
    intent: MemoryChatDeletionIntent,
    policyReceiptDigest: string,
    deliveryReceiptDigests: readonly string[],
    mode: "local-only" | "cleanup-and-rebuild"
  ) {
    if (
      !this.dependencies.policy.verifyReceipt(
        `${intent.operationId}:policy`,
        policyReceiptDigest
      )
    ) throw new Error("Policy 删除 receipt 无法重读验证");
    if (mode === "local-only" && deliveryReceiptDigests.length !== 0) {
      throw new Error("local-only 删除不应持有 Delivery receipt");
    }
    if (
      mode === "cleanup-and-rebuild" &&
      deliveryReceiptDigests.some(
        (receiptDigest) =>
          !this.dependencies.delivery.verifyReceiptDigest(receiptDigest)
      )
    ) throw new Error("Delivery 删除 receipt 无法重读验证");
  }

  async prepareProjectRebind(
    projectId: string,
    operationId: string,
    expectation: {
      expectedOldMemorySpaceId: string | null;
      expectedSpaceGenerationRevision: number | null;
      mode: "retain" | "new";
    }
  ) {
    if (
      expectation.expectedOldMemorySpaceId === null ||
      expectation.expectedSpaceGenerationRevision === null
    ) return { applied: false };
    const expectedSpaceGenerationRevision =
      expectation.expectedSpaceGenerationRevision;
    await this.dependencies.initializeOwners();
    if (!this.dependencies.ownerAvailable()) {
      throw new Error("Memory Policy 不可用，拒绝改绑 Project");
    }
    if (this.dependencies.policy.currentConsent()?.sharingMode !== "group") {
      return { applied: false };
    }
    const subject = { kind: "project" as const, projectId };
    const oldSpaceId = expectation.expectedOldMemorySpaceId;
    try {
      if (expectation.mode === "retain") {
        const retained = await memorySpaceGate.run(oldSpaceId, () => {
          const current = this.dependencies.policy.generationSnapshot(subject);
          const currentSpaceId = memorySpaceId(
            this.dependencies.policy.spaceFor(subject)
          );
          return current.revision === expectedSpaceGenerationRevision &&
            currentSpaceId === oldSpaceId;
        });
        if (!retained) {
          throw new Error("Project Memory generation 已变化，请重试改绑");
        }
        return { applied: false };
      }
      const advanced = await memorySpaceGate.run(oldSpaceId, () =>
        this.dependencies.policy.compareAndAdvance({
          operationId: `${operationId}:policy`, subject,
          expectedOldSpaceId: oldSpaceId,
          expectedSpaceGenerationRevision,
        }));
      if (advanced.kind === "superseded") {
        throw new Error("Project Memory generation 已变化，请重试改绑");
      }
      this.dependencies.revoked();
      await this.dependencies.delivery.drain(oldSpaceId);
      for (const instance of Object.values(this.dependencies.delivery.snapshot().providerInstances)) {
        await memorySpaceGate.run(oldSpaceId, () => this.dependencies.delivery.cleanup({
          operationId: `${operationId}:delivery:${instance.id}`,
          providerDataInstanceId: instance.id,
          providerId: instance.providerId,
          memorySpaceId: oldSpaceId,
          reason: "new-generation",
        }));
      }
      return { applied: true };
    } catch (cause) {
      throw Object.assign(
        cause instanceof Error ? cause : new Error("Project Memory 改绑失败"),
        {
          memoryEffectApplied: Boolean(
            this.dependencies.policy.receipt(`${operationId}:policy`)
          ),
        }
      );
    }
  }
}
