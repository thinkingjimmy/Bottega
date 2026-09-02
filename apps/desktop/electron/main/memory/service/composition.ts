/**
 * [INPUT]: Depends on MemoryService internal owners, runtime/network callbacks, live Chat accessors, and native-only history segment pages
 * [OUTPUT]: Provides Consent/Capture/Backfill/Rebuild/Pause controller one-way assembly with paged product-history wiring
 * [POS]: The composition root of the main/memory/service; Remove constructive noise from the business façade without additional truth
 */

import type { ChatRecord } from "../../../../shared/chats-ipc";
import type { MemoryNativeSegmentPage } from "../../chats/sqlite/database-protocol";
import type { MemoryEffectiveTarget } from "../../../../shared/memory-ipc";
import type { MemoryPrePromptValidation } from "../core/domain";
import type { FrozenTurnMemoryContext } from "../core/domain";
import type { TrustedProviderProof } from "../orchestration/capture-controller";
import { MemoryBackfillController } from "../orchestration/backfill-controller";
import { MemoryCaptureController } from "../orchestration/capture-controller";
import { MemoryConsentController } from "../orchestration/consent-controller";
import type { MemoryDeliveryStore } from "../delivery/store";
import type { MemoryCleanupRunner } from "../delivery/cleanup-runner";
import type { MemoryPolicyStore } from "../policy/store";
import { MemoryPauseController } from "../orchestration/pause-controller";
import { MemoryRebuildController } from "../orchestration/rebuild-controller";
import type { ManagedRuntimeRegistry } from "../runtime/managed-registry";
import type { MemoryNetworkRuntime } from "../runtime/network-runtime";

type Summary = {
  id: string;
  incarnationId: string;
  lastSeq: number;
  trimmedThroughSeq: number;
};

type Dependencies = {
  policy: MemoryPolicyStore;
  delivery: MemoryDeliveryStore;
  cleanup: MemoryCleanupRunner;
  network: MemoryNetworkRuntime;
  runtimes: ManagedRuntimeRegistry;
  readChat(chatId: string): Promise<ChatRecord | null>;
  listChatSummaries(): Promise<Summary[]>;
  readNativeChatSegment?(
    chatId: string,
    afterSeq: number,
    limit: number
  ): Promise<MemoryNativeSegmentPage | null>;
  initializeOwners(): Promise<void>;
  resolveTarget(providerId: string): Promise<MemoryEffectiveTarget>;
  destination(providerId: string): Promise<{ hostname: string; model: string }>;
  trusted(context: FrozenTurnMemoryContext, rebuild: boolean): Promise<TrustedProviderProof>;
  validateContext(context: FrozenTurnMemoryContext): MemoryPrePromptValidation;
  validate(context: FrozenTurnMemoryContext, proof: TrustedProviderProof, rebuild: boolean): boolean;
  providerId(): string;
  runtime(): { providerDataInstanceId: string; runtimeGeneration: number } | null;
  activateTarget(target: MemoryEffectiveTarget): void;
  changed(): void;
  captured(): void;
  publish(): void;
};

export function composeMemoryControllers(dependencies: Dependencies) {
  const consent = new MemoryConsentController({
    policy: dependencies.policy,
    initializeOwners: dependencies.initializeOwners,
    resolveTarget: dependencies.resolveTarget,
    destination: dependencies.destination,
    readChat: dependencies.readChat,
    listChatSummaries: dependencies.listChatSummaries,
    readNativeChatSegment: dependencies.readNativeChatSegment,
  });
  const capture = new MemoryCaptureController({
    delivery: dependencies.delivery,
    network: dependencies.network,
    readChat: dependencies.readChat,
    trustedProviderReady: (context) => dependencies.trusted(context, false),
    trustedRebuildProviderReady: (context) => dependencies.trusted(context, true),
    validateContext: dependencies.validateContext,
    validateFrozen: (context, proof) => dependencies.validate(context, proof, false),
    validateRebuildFrozen: (context, proof) =>
      dependencies.validate(context, proof, true),
    providerId: dependencies.providerId,
    captured: dependencies.captured,
  });
  const backfill = new MemoryBackfillController({
    policy: dependencies.policy,
    delivery: dependencies.delivery,
    capture,
    readChat: dependencies.readChat,
    listChatSummaries: dependencies.listChatSummaries,
    readNativeChatSegment: dependencies.readNativeChatSegment,
    runtime: dependencies.runtime,
  });
  const rebuild = new MemoryRebuildController({
    policy: dependencies.policy,
    delivery: dependencies.delivery,
    cleanup: dependencies.cleanup,
    consent,
    backfill,
    runtimes: dependencies.runtimes,
    resolveTarget: dependencies.resolveTarget,
    activateTarget: dependencies.activateTarget,
    prepareTransport: () => dependencies.network.reopen(),
    revoked: dependencies.changed,
    purgeModel: (providerId) =>
      dependencies.runtimes.require(providerId).descriptor.purgeModel,
  });
  const pause = new MemoryPauseController({
    policy: dependencies.policy,
    rebuildActive: () => rebuild.active(),
    initializeOwners: dependencies.initializeOwners,
    destination: dependencies.destination,
    changed: dependencies.changed,
    abortNetwork: () => dependencies.network.abortAll(),
    publish: dependencies.publish,
  });
  return { consent, capture, backfill, rebuild, pause };
}
