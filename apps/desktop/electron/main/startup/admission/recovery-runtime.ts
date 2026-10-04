/**
 * [INPUT]: Depends on Agent custody journals, App ownership probes, the Memory-facing Chat store, native-only Chat history segments, Memory owners, Project recovery, Settings, the lifecycle RecoveryReport, and the platform capability matrix
 * [OUTPUT]: Provides openStartupAdmission (turns admitted at once, held at the dispatch gate; Memory's startup deferred), recoverChatCreations (the one assembly index.ts calls: Chat Home creations and adopted continuations decided per record on the journals as they are then, a Chat still being created counting as live, R01), startup recovery for a previous life's agent-turn custody (the one-time convergence kept for upgrades: released or aborted entries let their request's App references go, quarantined ones keep them), custodyDependencyPorts (the App service's answers for dependencies, shared with host custody, ruling (a)) and paged Memory history plus lifecycle reconciliation reporting Agent custody's guardian runs on the bundled Node (bundledGuardian, TASK-35).
 * [POS]: The startup recovery composition boundary; index.ts retains lifecycle order while this module owns recovery-specific wiring
 */

import { chatHomeLiveness, relayOwnsIntent, type ChatHomeLiveness, type RelayLiveState } from "../../chat-home/recovery-live-intents";
import type { LifecycleIntent } from "../../lifecycle/intent-types";
import { recoverOrDefer } from "../../persistence/recovery-policy";
import { join } from "node:path";
import type { PlatformCapabilities } from "../../../../shared/platform/platform-capabilities";
import { asError } from "../../ipc/errors";
import type { AppsService } from "../../apps/apps-service";
import type { AgentTurnCustodyDependency } from "../../../../shared/apps/model/app-lifecycle";
import { AgentTurnCustodyJournal } from "../../backends/jobs/custody/agent-turn-custody-journal";
import {
  AgentTurnCustodyRuntime,
  type CustodyReconcileReport,
} from "../../backends/jobs/custody/agent-turn-custody-runtime";
import type { ChatStore } from "../../chats/chat-store";
import type { RecoveryReport } from "../../lifecycle/reconciliation";
import { announceComposition, compositionOverrides } from "../boot/composition-hooks";
import { ManagedRuntimeRegistry } from "../../memory/runtime/managed-registry";
import { MemoryLifecycleOrchestrator } from "../../memory/runtime/control/lifecycle-orchestrator";
import { MemoryService } from "../../memory/service/memory-service";
import { MemorySettingsOwner } from "../../memory/service/settings-owner";
import type { ProjectsService } from "../../projects/projects-service";
import type { SettingsStore } from "../../settings/settings-store";
import { bundledGuardian } from "../../runtime";

type AgentCustodyDependencies = Readonly<{
  userData: string;
  apps: AppsService;
}>;

/** The App service's answers for custody dependencies: shared by agent-turn recovery and host custody (TASK-11 flip, ruling (a)). */
export function custodyDependencyPorts(apps: Pick<AppsService, "isTurnReferenceActive" | "isTurnPlanActive" | "releaseTurnApps">) {
  return {
    active: (dependency: AgentTurnCustodyDependency) => dependency.kind === "app-reference" ? apps.isTurnReferenceActive(dependency.journalEntryId)
      : apps.isTurnPlanActive(dependency.planInstanceId),
    release: (requestId: string) => apps.releaseTurnApps(requestId).then(() => undefined),
  };
}

export async function recoverAgentTurnCustody({
  userData,
  apps,
}: AgentCustodyDependencies) {
  const journal = new AgentTurnCustodyJournal(userData);
  const runtime = new AgentTurnCustodyRuntime(journal, {
    controlRoot: join(userData, "agent-custody"),
    guardian: bundledGuardian,
  });
  await runtime.initialize();
  const report: CustodyReconcileReport = { released: [], aborted: [], quarantined: [] };
  await recoverOrDefer(async () => {
  Object.assign(report, await runtime.reconcile());
  for (const settled of [...report.released, ...report.aborted]) {
    await apps.releaseTurnApps(settled.turnRequestId);
  }
  for (const held of report.quarantined) {
    console.error(
      `[custody] ${held.custodyId} 进程状态无法确认，关联能力保持 quarantine（turn ${held.turnRequestId}）`
    );
  }
  });
  return { journal, runtime, report };
}

type MemoryRuntimeDependencies = Readonly<{
  userData: string;
  platformSupport: PlatformCapabilities;
  chats: ChatStore;
  settings: SettingsStore;
  projects: ProjectsService;
}>;

export async function initializeMemoryRuntime({
  userData,
  platformSupport,
  chats,
  settings,
  projects,
}: MemoryRuntimeDependencies) {
  const supplied = compositionOverrides.memoryRuntime?.(userData, platformSupport);
  const runtimes = supplied?.runtimes ?? new ManagedRuntimeRegistry(userData, { platformSupport });
  const service = new MemoryService(userData, {
    platformSupport,
    workflowRolesEnabled: () => settings.get().memoryWorkflowRoles,
    providerFactory: supplied?.providerFactory,
    readChat: (chatId) => chats.getConversation(chatId),
    readChatRef: (chatId) => chats.getChatRef(chatId),
    listChatSummaries: () => chats.listChatSummaries(),
    readNativeChatSegment: (chatId, afterSeq, limit) =>
      chats.memoryNativeSegment(chatId, afterSeq, limit),
    runtimes,
  });
  let lifecycle: MemoryLifecycleOrchestrator | null = null;
  const settingsOwner = new MemorySettingsOwner({
    settings,
    runtimes,
    apply: (target, memory) => service.applyMemoryConfig(target, memory),
    workflowConsentActive: () => Boolean(service.policy.activeConsent()),
    workflowRolesChanged: () => service.invalidateWorkflowRoles(),
    consumeConsentAuthority: (token, target, purpose) =>
      service
        .consumeConsentAuthority(token, target, purpose)
        .then(() => undefined),
    pause: (operationId) => service.pause(operationId),
    resume: (target, sharingMode, operationId) => service.resume(target, sharingMode, operationId),
    revokeConsentForDisable: (providerId) =>
      service.revokeConsentForDisable(providerId),
    pauseReceipt: (id) => { const receipt = service.policy.receipt(id); return receipt && service.policy.verifyReceipt(id, receipt.receiptDigest) ? receipt : null; },
    rebuildActive: () => service.rebuildActive(),
    lifecycleHeld: (providerId) => lifecycle?.isHeld(providerId) ?? false,
  });
  lifecycle = new MemoryLifecycleOrchestrator({
    runtimes,
    settings: settingsOwner,
    activeProvider: () => settings.get().memory.provider,
    activeMemory: () => settings.get().memory,
    consentDestination: (providerId, providerDataInstanceId) =>
      service.consentDestination(providerId, providerDataInstanceId),
    quiesce: () => service.quiesce(),
    reopen: () => service.reopen(),
    authorizeRebuild: (providerId) => service.authorizeRebuild(providerId),
    rebuild: (providerId) => service.rebuildWithinLifecycle(providerId),
    reconcileRuntimeConfig: (preview, confirmed) =>
      service.reconcileRuntimeConfig(preview, confirmed),
    terminalPublish: () => service.terminalPublish(),
  });
  runtimes.setLifecycleOrchestrator(lifecycle);
  service.setLifecycleOrchestrator(lifecycle);
  service.setTargetResolver((providerId) =>
    settingsOwner.resolveTarget({
      ...settings.get().memory,
      provider: providerId,
    })
  );
  await service.initializeForPlatform(
    () => settingsOwner.resolveTarget(),
    settings.get().memory
  );
  if (platformSupport.capabilities.memory) {
    await settingsOwner.retryApply();
    await service.prepareRebuildRecovery();
    await recoverOrDefer(async () => { await projects.recoverMemoryRebinds(); });
  }
  announceComposition("memory", { runtimes, service, settingsOwner, settings });
  return { runtimes, service, settingsOwner, lifecycle };
}

/**
 * Chat Home creations and adopted continuations that startup recovery settles. The live manual intents are read when each task
 * runs, not before it is deferred: admission is open while recovery holds, so a message admitted meanwhile is live, never an
 * orphan whose Chat Home gets rolled back.
 */
/**
 * The one assembly index.ts calls (R01): Chat Home and adopted-continuation recovery decide each record on the journals as they are when it
 * is decided, never on a set read before the deferral or an await. A Chat still being created (a raw or just-admitted reservation, or a
 * live manual intent) keeps its Home.
 */
export async function recoverChatCreations(input: {
  relay: () => RelayLiveState;
  lifecycle: () => Promise<Iterable<Pick<LifecycleIntent, "intentId" | "kind" | "terminal">>>;
  homes: { recoverCreations(liveness: ChatHomeLiveness): Promise<void> };
  continuations: (live: (intentId: string) => boolean) => Promise<void>;
}) {
  const liveness = chatHomeLiveness({ relay: input.relay, lifecycle: input.lifecycle });
  await recoverOrDefer(async () => input.homes.recoverCreations(liveness), { name: "chat-home-creations" });
  /* External sync must follow continuation reconcile (a new generation activated first would fence a pending finalize); that sync
     lives in the post-window queue, so this ordering holds. */
  await recoverOrDefer(async () => input.continuations(intentId => relayOwnsIntent(input.relay(), intentId)), { name: "adopted-continuations" });
}

/**
 * Turns are admitted at once: while startup recovery holds, each waits at the coordinator's dispatch gate (runNext) and the gate's
 * opening sends it. Deferring admission itself refused every message at the door ("relay service closing") for the whole hold.
 * Memory's startup still waits for recovery.
 */
export async function openStartupAdmission(coordinator: { reopenAdmission(): void }, memory: { completeStartup(): void }) {
  coordinator.reopenAdmission();
  await recoverOrDefer(async () => { memory.completeStartup(); }, { name: "memory-startup", required: true });
}

export function continueMemoryRebuildRecovery(memory: MemoryService) {
  setImmediate(() => {
    void memory
      .recoverRebuilds()
      .then((failures) => {
        for (const failure of failures) {
          console.warn(
            `[memory] rebuild ${failure.operationId} 启动恢复失败（${failure.failureKind}/${failure.phase}）：${failure.detail}`
          );
        }
      })
      .catch((cause) => {
        console.warn("[memory] rebuild 后台恢复任务异常", asError(cause));
      });
  });
}

export function reportLifecycleReconciliation(report: RecoveryReport) {
  if (report.unhandled.length) {
    throw new Error(
      `存在未注册的 lifecycle intent：${report.unhandled
        .map((item) => item.kind)
        .join(", ")}`
    );
  }
  for (const failure of report.projectionFailures) {
    console.warn(
      `[lifecycle] projection ${failure.name} 对账失败，待下次启动重试：${failure.message}`
    );
  }
  for (const failure of report.failed) {
    console.error(
      `[lifecycle] intent ${failure.kind}(${failure.intentId}) 恢复失败：${failure.message}`
    );
  }
  for (const item of report.skipped) {
    console.warn(
      `[lifecycle] intent ${item.kind}(${item.intentId}) 本轮跳过：${item.why}`
    );
  }
  console.info(
    `[lifecycle] 开机对账：恢复 ${report.consumed.length}、跳过 ${report.skipped.length}、失败 ${report.failed.length}、压缩终态 ${report.compactedTerminals}`
  );
}
