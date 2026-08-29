/**
 * [INPUT]: Depends on Agent custody journals, App/Chat ownership probes, Memory owners, Project recovery, Settings, and the platform capability matrix
 * [OUTPUT]: Provides ordered startup recovery for Agent custody and Memory plus lifecycle reconciliation reporting
 * [POS]: The startup recovery composition boundary; index.ts retains lifecycle order while this module owns recovery-specific wiring
 */

import { join } from "node:path";
import type { PlatformCapabilities } from "../../../shared/platform-capabilities";
import { asError } from "../errors";
import type { AppsService } from "../apps/apps-service";
import { AgentTurnCustodyJournal } from "../backends/agent-turn-custody-journal";
import { AgentTurnCustodyRuntime } from "../backends/agent-turn-custody-runtime";
import type { ChatStore } from "../chats/chat-store";
import { ManagedRuntimeRegistry } from "../memory/runtime/managed-registry";
import { MemoryLifecycleOrchestrator } from "../memory/runtime/control/lifecycle-orchestrator";
import { MemoryService } from "../memory/service/memory-service";
import { MemorySettingsOwner } from "../memory/service/settings-owner";
import type { ProjectsService } from "../projects/projects-service";
import type { SettingsStore } from "../settings-store";

type AgentCustodyDependencies = Readonly<{
  userData: string;
  mainDirectory: string;
  apps: AppsService;
  chats: ChatStore;
}>;

export async function recoverAgentTurnCustody({
  userData,
  mainDirectory,
  apps,
  chats,
}: AgentCustodyDependencies) {
  const journal = new AgentTurnCustodyJournal(userData);
  const runtime = new AgentTurnCustodyRuntime(journal, {
    controlRoot: join(userData, "agent-custody"),
    guardianArgs: [join(mainDirectory, "custody-guardian-entry.js")],
  });
  runtime.registerDependencyProbe(
    "app-reference",
    (dependency) =>
      dependency.kind === "app-reference" &&
      apps.isTurnReferenceActive(dependency.journalEntryId)
  );
  runtime.registerDependencyProbe(
    "extension-plan",
    (dependency) =>
      dependency.kind === "extension-plan" &&
      apps.isTurnPlanActive(dependency.planInstanceId)
  );
  runtime.setOwnerProbe((owner) =>
    owner.kind === "chat-turn"
      ? chats.has(owner.ownerId)
      : owner.kind === "app-internal-turn"
  );
  await runtime.initialize();
  const report = await runtime.reconcile();

  for (const settled of [...report.released, ...report.aborted]) {
    await apps.releaseTurnApps(settled.turnRequestId);
  }
  for (const held of report.quarantined) {
    console.error(
      `[custody] ${held.custodyId} 进程状态无法确认，关联能力保持 quarantine（turn ${held.turnRequestId}）`
    );
  }
  runtime.openAdmission();
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
  const runtimes = new ManagedRuntimeRegistry(userData, { platformSupport });
  const service = new MemoryService(userData, {
    platformSupport,
    readChat: (chatId) => chats.get(chatId),
    readChatRef: (chatId) => chats.getChatRef(chatId),
    listChatSummaries: () => chats.listChatSummaries(),
    runtimes,
  });
  let lifecycle: MemoryLifecycleOrchestrator | null = null;
  const settingsOwner = new MemorySettingsOwner({
    settings,
    runtimes,
    apply: (target, memory) => service.applyMemoryConfig(target, memory),
    consumeConsentAuthority: (token, target, purpose) =>
      service
        .consumeConsentAuthority(token, target, purpose)
        .then(() => undefined),
    pause: () => service.pause(),
    resume: (target, sharingMode) => service.resume(target, sharingMode),
    revokeConsentForDisable: (providerId) =>
      service.revokeConsentForDisable(providerId),
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
    await service.prepareRebuildRecovery();
    await projects.recoverMemoryRebinds();
  }
  return { runtimes, service, settingsOwner, lifecycle };
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

type LifecycleReconciliationReport = Readonly<{
  unhandled: ReadonlyArray<Readonly<{ kind: string }>>;
  projectionFailures: ReadonlyArray<Readonly<{ name: string; message: string }>>;
  failed: ReadonlyArray<Readonly<{ kind: string; intentId: string; message: string }>>;
  skipped: ReadonlyArray<Readonly<{ kind: string; intentId: string; why: string }>>;
  consumed: readonly unknown[];
  compactedTerminals: number;
}>;

export function reportLifecycleReconciliation(
  report: LifecycleReconciliationReport
) {
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
