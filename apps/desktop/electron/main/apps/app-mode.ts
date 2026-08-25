/**
 * [INPUT]: Depends on Apps/Projects/Chats/Bases Services, lifecycle, baseline, SkillsCatalog, Settings, Archive availability, packet import/sharing with the Agent chat control port
 * [OUTPUT]: Provides configureAppMode, install attachment fence, chat slots/promotion/Save/Delete/Base import/GitHub share, system skill turn with canonical Workspace owner/held gate, App×Extension integration and fully boot recovery handler
 * [POS]: The App Mode of the apps module is the combination root; The network is comprised of a SessionRef, a thread scope, an App chat slot, an App shell, a single D17/D26 fence, a shared drain provider and a package saga recoveryThe app-delete recovery failed to return to record, and the "permanent card death" was silent on the interface
 */

import type { SessionRef } from "../../../shared/agent-ipc";
import { dirname } from "node:path";
import type { ChatRecord } from "../../../shared/chats-ipc";
import { BasePromotionService } from "../bases/base-promotion-service";
import type { BaseStore } from "../bases/base-store";
import type { BasesService } from "../bases/bases-service";
import type { ChatStore } from "../chats/chat-store";
import type { ChatsService } from "../chats/chats-service";
import { AdmissionGate } from "../lifecycle/admission-gate";
import type { LifecycleIntentStore } from "../lifecycle/intent-store";
import { LifecycleReconciliation } from "../lifecycle/reconciliation";
import type { ProjectStore } from "../projects/project-store";
import type { ProjectsService } from "../projects/projects-service";
import type { ConversationCoordinator } from "../sections/coordinator/conversation-coordinator";
import type { SettingsStore } from "../settings-store";
import type { SkillsCatalog } from "../skills-catalog";
import { AppDeleteService } from "./app-delete";
import { AppChatSlots } from "./app-chat-slots";
import { AppAttachmentFence } from "./attachments/attachment-fence";
import { AppGrantAuthority } from "./attachments/grant-authority";
import { AppAttachmentSurfaceLeaseRegistry } from "./attachments/surface-leases";
import { AppManagementLeaseRegistry } from "./attachments/management-leases";
import type { AppsService } from "./apps-service";
import { SaveAsAppService } from "./save-as-app";
import { BaseAppImporter } from "./install/import-base-app";
import { ShareFlow } from "./share/share-flow";
import { AppGenerationDrainProviderRegistry } from "../lifecycle/app-generation-drain-providers";
import { AppGenerationBuildParticipantRegistry } from "../lifecycle/app-generation-build-participants";
import { AppGenerationRetirementCoordinator } from "../lifecycle/app-generation-retirement";
import { createAppExtensionIntegration } from "../extensions/integration/app-extension-composition";
import { resolveConversationContext } from "../workspace-resolver";

type AppModeDependencies = {
  apps: AppsService;
  projects: ProjectsService;
  projectStore: ProjectStore;
  chats: ChatsService;
  chatStore: ChatStore;
  bases: BasesService;
  baseStore: BaseStore;
  intents: LifecycleIntentStore;
  coordinator: ConversationCoordinator;
  skills: SkillsCatalog;
  settings: SettingsStore;
  hasConversationActivity(ids: Iterable<string>): boolean;
  isConversationAvailable(chatId: string): boolean;
  cancelConversations(ids: Iterable<string>): Promise<void>;
  bindThreadScope(session: SessionRef, chatId: string): void;
  releaseThreadScope(chatId: string): void;
};

export function configureAppMode(dependencies: AppModeDependencies) {
  const gate = new AdmissionGate(dependencies.intents);
  const reconciliation = new LifecycleReconciliation(
    dependencies.intents,
    gate
  );
  const chatSlots = new AppChatSlots({
    apps: dependencies.apps.store,
    chats: dependencies.chatStore,
    projects: dependencies.projectStore,
    gate,
    publish: (record) => dependencies.apps.publishStatus(record),
  });
  dependencies.apps.configureChatSlots(chatSlots);
  /* fence 先于 grant authority：两个方向共用同一批 gate 与同一条 D17 判定，
     谁都不能自带第二份实例——那等于在锁序图上多画一条互不相识的边。 */
  const fence = new AppAttachmentFence({
    apps: dependencies.apps.store,
    chats: dependencies.chatStore,
    projects: dependencies.projectStore,
    admission: dependencies.apps.admission,
    activeReferences: (chatId) =>
      dependencies.apps.referenceJournal.listByOwner(chatId),
  });
  dependencies.apps.configureAttachmentFence(fence);
  const grantAuthority = new AppGrantAuthority(
    dependencies.apps.store,
    dependencies.chatStore,
    dependencies.projectStore,
    fence
  );
  dependencies.apps.configureGrantAuthority(grantAuthority);
  const surfaceLeases = new AppAttachmentSurfaceLeaseRegistry(
    dependencies.apps.store,
    dependencies.projectStore,
    grantAuthority
  );
  dependencies.apps.configureSurfaceLeases(surfaceLeases);
  /* 管理会话与 attachment surface 是同一层「App-hosted UI capability」的两半：
     一半绑 conversation，一半绑 App 详情页。它们共用同一批撤销点。 */
  dependencies.apps.configureManagementLeases(
    new AppManagementLeaseRegistry(dependencies.apps.store)
  );
  dependencies.bases.configureAppSurfaceValidator(surfaceLeases);
  dependencies.bases.ownerResolver.configureAppAttachments({
    effectiveGrant: (chatId, appId) =>
      grantAuthority.effectiveGrant(chatId, appId),
    projectForApp: (appId) => dependencies.projectStore.findByAppId(appId),
  });
  reconciliation.registerRecovery("chat-slot", (intent) =>
    chatSlots.recover(intent)
  );
  reconciliation.registerProjection("app-chat-slots", () =>
    chatSlots.reconcile()
  );
  const promotion = configurePromotion(dependencies, gate, reconciliation);
  const saveAsApp = configureSave(
    dependencies,
    gate,
    fence,
    reconciliation,
    promotion
  );
  /* drain providers 必须早于 delete 建立：App×Extension 要把 reservation 计数
     注册进同一张表，普通 promote 与 delete 才能拿到同一份 retirement proof。 */
  const drainProviders = new AppGenerationDrainProviderRegistry();
  const extensions = configureExtensionIntegration(dependencies, drainProviders);
  configurePackageFlows(dependencies, gate, reconciliation, extensions);
  configureDelete(dependencies, gate, reconciliation, drainProviders);
  return { reconciliation, saveAsApp, extensions };
}

function configureExtensionIntegration(
  dependencies: AppModeDependencies,
  drainProviders: AppGenerationDrainProviderRegistry
) {
  const participants = new AppGenerationBuildParticipantRegistry();
  const integration = createAppExtensionIntegration({
    userData: dependencies.apps.userData,
    participants,
    drainProviders,
    /* participant 只经这条窄读口看 AppStore 已落账的 frozen set，绝不 import Store */
    readSealedResolution: ({ appId, appGenerationId }) => {
      const resolution = dependencies.apps.store
        .get(appId)
        ?.generations.find((item) => item.generationId === appGenerationId)
        ?.extensionRequirementResolution;
      return resolution?.kind === "frozen" ? resolution : null;
    },
    /* 迁移只是「起一条新的 pending 代」；新代身份、consent 与 promote 仍归
       AppStore 单写，Extensions 侧不碰 App 的生命周期。 */
    migrateAppGeneration: async (appId, migrationId) => {
      await dependencies.apps.store.migrateGeneration(appId, migrationId);
    },
  });
  /* 停用收敛的两个外部面在这里装配：撤销面缺席（产品尚未开放 fixed
     projection，因此从不产生 binding），一旦真有 binding 就 fail closed 而不是
     冒充已撤销；会话面用既有的 cancel + rotate，不另造一套会话生命周期。 */
  integration.convergence.configure({
    custody: {
      list: async (workspaceKeys) => sessionsIn(workspaceKeys, dependencies),
      drain: async (chatIds) => {
        await dependencies.cancelConversations(chatIds);
        for (const chatId of chatIds) {
          const chat = await dependencies.chatStore.get(chatId);
          if (chat) await rotateSession(chat, dependencies);
        }
      },
      invalidateDiscoveryCache: () => dependencies.skills.invalidate(),
    },
  });
  dependencies.apps.configureExtensions(integration, participants);
  return integration;
}

/* 只有 ambient 投影会进入会话的 discovery snapshot，所以受影响面精确到
   「有过 binding 的 workspace」；已绑定后端 session 的聊天才算「持有快照」。 */
async function sessionsIn(
  workspaceKeys: readonly string[],
  dependencies: AppModeDependencies
) {
  const targets = new Set(workspaceKeys);
  const held: string[] = [];
  for (const summary of dependencies.chatStore.list()) {
    const chat = await dependencies.chatStore.get(summary.id);
    if (!chat?.session) continue;
    const workspace = conversationWorkspace(summary.id, dependencies);
    if (workspace && targets.has(workspace)) held.push(summary.id);
  }
  return held;
}

function conversationWorkspace(
  conversationId: string,
  dependencies: AppModeDependencies
) {
  try {
    return resolveConversationContext(
      conversationId,
      dependencies.projects,
      dependencies.chatStore
    ).workspace;
  } catch {
    /* 解析不出 workspace 的聊天不可能持有该投影的 discovery snapshot。 */
    return null;
  }
}

function configurePackageFlows(
  dependencies: AppModeDependencies,
  gate: AdmissionGate,
  reconciliation: LifecycleReconciliation,
  extensions: ReturnType<typeof configureExtensionIntegration>
) {
  const importer = new BaseAppImporter(
    dependencies.apps.store,
    dependencies.projects,
    dependencies.bases,
    dependencies.baseStore,
    dependencies.apps.configs,
    dependencies.intents,
    gate,
    (record) => dependencies.apps.publishStatus(record)
  );
  importer.configureExtensions(extensions.installer);
  const share = new ShareFlow(
    dirname(dependencies.apps.store.appsRoot),
    dependencies.apps.store,
    dependencies.projectStore,
    dependencies.baseStore,
    dependencies.intents,
    gate,
    (record) => dependencies.apps.publishStatus(record)
  );
  dependencies.apps.configurePackageFlows(importer, share);
  /* 两个 kind 同一条流水线：来源分家只为恢复面互不污染，恢复实现不复制。 */
  reconciliation.registerRecovery("base-import", (intent) =>
    importer.recover(intent)
  );
  reconciliation.registerRecovery("preset-install", (intent) =>
    importer.recover(intent)
  );
  reconciliation.registerRecovery("share-publish", (intent) =>
    share.recover(intent)
  );
}

function configurePromotion(
  dependencies: AppModeDependencies,
  gate: AdmissionGate,
  reconciliation: LifecycleReconciliation
) {
  const promotion = new BasePromotionService(
    dependencies.baseStore,
    dependencies.bases.ownerResolver,
    dependencies.intents,
    gate,
    {
      runConversationExclusive: (chatId, task) =>
        dependencies.coordinator.runConversationExclusive(chatId, task),
      hasActiveTurn: (chatId) =>
        dependencies.hasConversationActivity([chatId]),
      onEvent: (event) => dependencies.bases.publishEvent(event),
    }
  );
  dependencies.bases.configurePromotion(promotion);
  reconciliation.registerRecovery("base-promotion", (intent) =>
    promotion.recover(intent)
  );
  return promotion;
}

function configureSave(
  dependencies: AppModeDependencies,
  gate: AdmissionGate,
  fence: AppAttachmentFence,
  reconciliation: LifecycleReconciliation,
  promotion: BasePromotionService
) {
  const saveAsApp = new SaveAsAppService({
    store: dependencies.apps.store,
    projects: dependencies.projects,
    chats: dependencies.chatStore,
    bases: dependencies.baseStore,
    promotion,
    intents: dependencies.intents,
    gate,
    fence,
    coordinator: dependencies.coordinator,
    hasActiveTurn: (chatId) =>
      dependencies.hasConversationActivity([chatId]),
    isChatAvailable: (chatId) =>
      dependencies.isConversationAvailable(chatId),
    rotateSession: (chat) => rotateSession(chat, dependencies),
    restoreSession: (chat, session) =>
      restoreSession(chat, session, dependencies),
    removeShell: (record) => dependencies.apps.removeBaseShell(record),
    enqueueSkillTurnHeld: (input) => enqueueSkillTurn(input, dependencies),
    onStatus: (record) => dependencies.apps.publishStatus(record),
  });
  dependencies.apps.configureSaveAsApp(saveAsApp, {
    renameBase: (record, name) =>
      renameBaseApp(record.id, name, dependencies),
    invalidateSkills: () => dependencies.skills.invalidate(),
  });
  reconciliation.registerRecovery("save-as-app", (intent) =>
    saveAsApp.recover(intent)
  );
  return saveAsApp;
}

function configureDelete(
  dependencies: AppModeDependencies,
  gate: AdmissionGate,
  reconciliation: LifecycleReconciliation,
  drainProviders: AppGenerationDrainProviderRegistry
) {
  const retirement = new AppGenerationRetirementCoordinator(
    {
      counts: ({ appId, generationId }) =>
        dependencies.apps.generationDrainCounts(appId, generationId),
    },
    drainProviders
  );
  const appDelete = new AppDeleteService({
    store: dependencies.apps.store,
    projects: dependencies.projects,
    intents: dependencies.intents,
    gate,
    coordinator: dependencies.coordinator,
    listProjectChats: (projectId) =>
      dependencies.chatStore.listByProject(projectId),
    getChat: (chatId) => dependencies.chatStore.get(chatId),
    drainProjectTurns: (projectId) =>
      dependencies.cancelConversations(
        dependencies.chatStore.listByProject(projectId)
      ),
    rotateSession: (chat) => rotateSession(chat, dependencies),
    removeShell: (record) => dependencies.apps.removeBaseShell(record),
    closeAdmission: (appId) => dependencies.apps.closeDeleteAdmission(appId),
    settleBuilds: (appId) => dependencies.apps.settleDeleteBuilds(appId),
    retireGeneration: (appId, generationId) =>
      retirement.proof({ appId, generationId }).then(() => undefined),
    revokeCapabilities: (appId) =>
      dependencies.apps.revokeDeleteCapabilities(appId),
    settleData: (record, mode) =>
      dependencies.apps.settleDeleteData(record, mode),
  });
  dependencies.apps.configureAppDelete(appDelete);
  /* 恢复失败从前只进 RecoveryReport 与 console，record 一根汗毛不动——界面上
     那个 App 照样「已就绪」，而点删除必撞 409。失败当场落到 record 上，
     「重试删除残留」才有门；re-throw 保持 report 的失败计数如实。 */
  reconciliation.registerRecovery("app-delete", async (intent) => {
    try {
      return await appDelete.recover(intent);
    } catch (cause) {
      await dependencies.apps.markDeleteStalled(
        String((intent.input as { appId?: unknown }).appId ?? ""),
        `开机恢复删除失败（停在 ${intent.phase}）：${
          cause instanceof Error ? cause.message : String(cause)
        }`
      );
      throw cause;
    }
  });
}

async function rotateSession(
  chat: ChatRecord,
  dependencies: AppModeDependencies
) {
  if (!chat.session) return;
  await dependencies.chats.replaceSession(
    { conversationId: chat.id },
    chat.session,
    null
  );
  dependencies.releaseThreadScope(chat.id);
  const current = await dependencies.chatStore.get(chat.id);
  if (!current) return;
  dependencies.chats.publishRecord(current);
  dependencies.chats.publishSessionInvalidated(current);
}

async function restoreSession(
  chat: ChatRecord,
  session: SessionRef | null,
  dependencies: AppModeDependencies
) {
  const current = await dependencies.chatStore.get(chat.id);
  if (!current) throw new Error("回滚 SessionRef 时聊天不存在");
  if (sameSession(current.session, session)) {
    if (session) dependencies.bindThreadScope(session, chat.id);
    return;
  }
  if (current.session && session) {
    throw new Error("回滚 SessionRef 时聊天已绑定其他 session");
  }
  if (current.session) {
    await rotateSession(current, dependencies);
    return;
  }
  if (!session) return;
  await dependencies.chats.handleSessionBound(
    { conversationId: chat.id },
    session
  );
  dependencies.bindThreadScope(session, chat.id);
  const restored = await dependencies.chatStore.get(chat.id);
  if (restored) dependencies.chats.publishRecord(restored);
}

function sameSession(left: SessionRef | null, right: SessionRef | null) {
  return (
    left === right ||
    Boolean(
      left &&
        right &&
        left.backend === right.backend &&
        left.id === right.id
    )
  );
}

async function enqueueSkillTurn(
  input: {
    chat: ChatRecord;
    turnIntentId: string;
    prompt: string;
    projectLifecycleHeld: true;
  },
  dependencies: AppModeDependencies
) {
  const { chat, turnIntentId, prompt, projectLifecycleHeld } = input;
  // 幂等按 id 而非哈希：turnIntentId 由 saga 派生全局唯一，账本已有此 intent
  // （任意 phase）即「就是我们那笔」。重建提交的哈希必然漂移（createdAt、
  // settings 快照、skill ref 都不冻结），按哈希判重会把恢复重入误判为冲突。
  if (dependencies.coordinator.durableTurnPhase(chat.id, turnIntentId)) return;
  const skill = (
    await dependencies.skills.list({
      scope: { kind: "conversation", conversationId: chat.id },
      backend: chat.agent,
      planMode: false,
    })
  ).find((candidate) => candidate.name === "create-app-skill");
  if (!skill) throw new Error("系统 create-app-skill 不可用");
  const turnOptions = await dependencies.settings.resolveChatOptions(
    { conversationId: chat.id },
    chat.agent
  );
  const precondition = {
    kind: "existing" as const,
    incarnationId: chat.incarnationId,
  };
  const project = chat.projectId
    ? dependencies.projectStore.get(chat.projectId)
    : undefined;
  if (chat.projectId && !project) {
    throw new Error("系统 turn 的 Project 已不存在");
  }
  const workspacePrecondition =
    project && project.workspaceBinding.kind !== "none"
      ? {
          kind: "project" as const,
          projectId: project.id,
          membershipRevision: project.membershipRevision,
        }
      : {
          kind: "chat-home" as const,
          conversationId: chat.id,
          incarnationId: chat.incarnationId,
        };
  const submission: Parameters<
    ConversationCoordinator["submitTransitionTurnHeld"]
  >[0] = {
    intentId: turnIntentId,
    persistence: {
      kind: "append",
      input: {
        chatId: chat.id,
        message: {
          id: `${turnIntentId}-user`,
          role: "user",
          content: prompt,
          createdAt: Date.now(),
        },
        precondition,
      },
    },
    content: {
      schemaVersion: 1,
      origin: "system",
      capabilityEpoch: 0,
      backendEpoch: 0,
      content: { richValue: [], displayText: prompt, files: [] },
    },
    precondition,
    workspacePrecondition,
    turn: {
      requestId: `${turnIntentId}-request`,
      scope: { conversationId: chat.id },
      turnOptions,
      input: [
        { type: "text", text: prompt },
        { type: "skill", skillRef: skill.ref },
      ],
    },
  };
  const receipt = await dependencies.coordinator.submitTransitionTurnHeld(
    submission,
    projectLifecycleHeld
  );
  if (receipt.phase === "failed") {
    throw new Error("create-app-skill turn 未能持久入队");
  }
}

async function renameBaseApp(
  appId: string,
  name: string,
  dependencies: AppModeDependencies
) {
  const project = dependencies.projectStore.findByAppId(appId);
  if (!project) throw new Error("Base App 缺少 Project");
  await dependencies.projects.runExclusive(async () => {
    await dependencies.projectStore.rename(project.id, name);
    dependencies.projects.publishStored(project.id);
    const ownerKey = `project:${project.id}` as const;
    const base = await dependencies.bases.get(ownerKey);
    if (base && base.meta.name !== name) {
      await dependencies.bases.updateMeta({
        ownerKey,
        expectedRevision: base.meta.revision,
        patch: { name },
        authority: await dependencies.bases.issueSystemMutationAuthority(
          ownerKey,
          "meta"
        ),
      });
    }
  });
}
