/**
 * [INPUT]: Depends on Apps/Projects/Chats/Bases services, lifecycle, current locale, SkillsCatalog, settings/archive, package import/share, and Agent turn control
 * [OUTPUT]: Provides configureAppMode with canonical use-chat slots, ordinary and Studio-only grants, promotion, convergent save/delete with post-finalization removal publication, Base import, sharing, Skills turns, Extensions, and recovery
 * [POS]: Apps-domain composition root; wires Project grant commits to durable Project publication
 */

import type { SessionRef } from "../../../shared/agent-ipc";
import type { AppLocale } from "../../../shared/i18n/locale";
import { dirname } from "node:path";
import { BasePromotionService } from "../bases/base-promotion-service";
import type { BaseStore } from "../bases/base-store";
import type { BasesService } from "../bases/bases-service";
import type { ChatStore } from "../chats/chat-store";
import type { ChatMetadata } from "../chats/chat-summary";
import type { ChatsService } from "../chats/chats-service";
import { AdmissionGate } from "../lifecycle/admission-gate";
import type { LifecycleIntentStore } from "../lifecycle/intent-store";
import { LifecycleReconciliation } from "../lifecycle/reconciliation";
import type { ProjectStore } from "../projects/store/project-store";
import type { ProjectsService } from "../projects/projects-service";
import type { ConversationCoordinator } from "../sections/coordinator/conversation-coordinator";
import type { SettingsStore } from "../settings-store";
import type { SkillsCatalog } from "../skills-catalog";
import type { SkillsTurnCustodyStore } from "../skills-management/turn-custody";
import type { ExtensionRuntimeHolder } from "../extensions/lifecycle/disable-convergence";
import type { ExtensionProjectionLedger } from "../extensions/lifecycle/projection-ledger";
import { AppDeleteService } from "./conversion/app-delete";
import { AppChatSlots } from "./turn/app-chat-slots";
import { AppNavigationService } from "./turn/app-navigation";
import { windowRegistry } from "../window/surfaces/window-registry";
import { surfaceWindowController } from "../window/surfaces/surface-window-controller";
import { WINDOW_SURFACES_CHANNEL } from "../../../shared/window-surfaces-ipc";
import {
  hasCanonicalChatPlacement,
  productDestinationRoute,
} from "../../../shared/placement/facts";
import { AppAttachmentFence } from "./attachments/attachment-fence";
import { AppGrantAuthority } from "./attachments/grant-authority";
import { AppAttachmentSurfaceLeaseRegistry } from "./attachments/surface-leases";
import type { AppsService } from "./apps-service";
import { SaveAsAppService } from "./conversion/save-as-app";
import { BaseAppImporter } from "./install/import-base-app";
import { ShareFlow } from "./share/share-flow";
import { AppGenerationDrainProviderRegistry } from "../lifecycle/app-generation-drain-providers";
import { AppGenerationBuildParticipantRegistry } from "../lifecycle/app-generation-build-participants";
import { AppGenerationRetirementCoordinator } from "../lifecycle/app-generation-retirement";
import { createAppExtensionIntegration } from "../extensions/integration/app-extension-composition";

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
  locale(): AppLocale;
  hasConversationActivity(ids: Iterable<string>): boolean;
  isConversationAvailable(chatId: string): boolean;
  cancelConversations(ids: Iterable<string>): Promise<void>;
  cancelAgentRequests(ids: Iterable<string>): Promise<void>;
  skillsTurnCustody(): SkillsTurnCustodyStore | null;
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
    canonicalizeUse: (input) =>
      dependencies.chats.createDormantAppChat({
        ...input,
        appRole: "use",
      }),
  });
  dependencies.apps.configureChatSlots(chatSlots);
  const navigation = new AppNavigationService({
    apps: dependencies.apps.store,
    chats: dependencies.chatStore,
    projects: dependencies.projectStore,
    slots: chatSlots,
    runExclusive: (appId, operation) =>
      dependencies.apps.runAppLifecycleMutation(appId, operation),
    revokeOld: (intent) => Promise.resolve(surfaceWindowController.revokeAppUseChat(intent)),
    drainOld: (intent) => intent.source
      ? dependencies.cancelConversations([intent.source.id])
      : Promise.resolve(),
    claimTarget: (intent) => Promise.resolve(surfaceWindowController.claimAppUseChat(intent)),
    captureSurfaceFence: (appId, source, target) =>
      surfaceWindowController.captureAppUseSurfaceFence(appId, source, target),
    validateSurfaceFence: (intent) =>
      surfaceWindowController.assertAppUseSurfaceFence(intent),
    focusMain: async (destination, intent) => {
      if (destination.kind === "app-use-chat") {
        await surfaceWindowController.focusAppUseInMain(destination, intent);
        return;
      }
      const main = windowRegistry.main();
      if (!main) return;
      main.window.webContents.send(WINDOW_SURFACES_CHANNEL.command, {
        type: "navigate",
        route: productDestinationRoute(destination),
      });
      windowRegistry.focus(main.windowId);
    },
  });
  dependencies.apps.configureNavigation(navigation);
  dependencies.chats.configureAppChatDeactivation((chat, action) =>
    navigation.prepareChatDeactivation(chat, action)
  );
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
    fence,
    (projectId) => dependencies.projects.publishStored(projectId),
    dependencies.apps.baseGuiGrants
  );
  dependencies.apps.configureGrantAuthority(grantAuthority);
  const surfaceLeases = new AppAttachmentSurfaceLeaseRegistry(
    dependencies.apps.store,
    dependencies.projectStore,
    grantAuthority
  );
  dependencies.apps.configureSurfaceLeases(surfaceLeases);
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
  reconciliation.registerProjection("app-navigation", () =>
    navigation.recover()
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
    projectContextForApp: (appId) => {
      const project = dependencies.projectStore.findByAppId(appId);
      if (!project || project.deletionCheckpoint) {
        throw new Error("App Project 不存在或正在删除");
      }
      return {
        projectId: project.id,
        projectLifecycleRevision: project.projectLifecycleRevision,
      };
    },
    backendForApp: (appId) => {
      const app = dependencies.apps.store.get(appId);
      if (!app) throw new Error("App 不存在");
      return app.agent;
    },
    projectInstallAuthority: {
      acquire: async (receipt) => {
        await dependencies.projectStore.acquireResourceAdmission(
          receipt.projectId,
          {
            kind: "extension-install",
            operationId: receipt.operationId,
            installIdentity: receipt.installIdentity,
            projectLifecycleRevision: receipt.projectLifecycleRevision,
          }
        );
      },
      assert: (receipt) => {
        dependencies.projectStore.assertResourceAdmission(
          receipt.projectId,
          receipt.operationId,
          receipt.installIdentity,
          receipt.projectLifecycleRevision
        );
      },
      release: (receipt) =>
        dependencies.projectStore.releaseResourceAdmission(
          receipt.projectId,
          receipt.operationId,
          receipt.installIdentity,
          receipt.projectLifecycleRevision
        ),
    },
  });
  /* 停用收敛的两个外部面在这里装配：撤销面缺席（产品尚未开放 fixed
     projection，因此从不产生 binding），一旦真有 binding 就 fail closed 而不是
     冒充已撤销；会话面用既有的 cancel + rotate，不另造一套会话生命周期。 */
  integration.convergence.configure({
    custody: {
      list: async (input) =>
        exactHolders(input, dependencies, integration.projections),
      drain: async (holders) => {
        const requestIds = holders.flatMap((holder) =>
          holder.kind === "request" ? [holder.requestId] : []
        );
        const preparedRequestIds = holders.flatMap((holder) =>
          holder.kind === "prepared-request" ? [holder.requestId] : []
        );
        const chatIds = holders.flatMap((holder) =>
          holder.kind === "conversation" ? [holder.conversationId] : []
        );
        if (requestIds.length) await dependencies.cancelAgentRequests(requestIds);
        for (const requestId of preparedRequestIds) {
          await dependencies.coordinator.cancelManualTurn(requestId);
        }
        if (chatIds.length) await dependencies.cancelConversations(chatIds);
        for (const chatId of chatIds) {
          const chat = dependencies.chatStore.getMetadata(chatId);
          if (chat) await rotateSession(chat, dependencies);
        }
        for (const holder of holders) {
          if (holder.kind !== "conversation") continue;
          await Promise.all([
            integration.projections.releaseSessionDiscovery(
              holder.conversationId,
              holder.session
            ),
            dependencies.apps.thirdPartyMcpPlans.releaseSessionDiscovery(
              holder.conversationId,
              holder.session
            ),
          ]);
        }
      },
      invalidateDiscoveryCache: (scope) =>
        dependencies.skills.invalidateProject(
          scope.kind === "project" ? scope.projectId : null
        ),
    },
  });
  dependencies.projects.resourceCleanup.register({
    id: "extensions",
    cleanup: (context) => integration.cleanupProject(context),
  });
  dependencies.projects.resourceCleanup.assertRequiredParticipantsRegistered();
  dependencies.apps.configureExtensions(integration, participants);
  return integration;
}

async function exactHolders(
  input: {
    operationId: string;
    installIdentity: string;
    componentInstanceIdentities: readonly string[];
    workspaceKeys: readonly string[];
    scope: import("../../../shared/product-resource-scope").ProductResourceScope;
  },
  dependencies: AppModeDependencies,
  projections: ExtensionProjectionLedger
): Promise<ExtensionRuntimeHolder[]> {
  const ambient = projections.sessionsAffected(input.operationId);
  const manual = dependencies.skillsTurnCustody()?.holdersOfInstall(
    input.installIdentity
  ) ?? [];
  const componentIdentities = new Set(input.componentInstanceIdentities);
  await dependencies.apps.thirdPartyMcpPlans.beginSessionRevoke(
    input.operationId,
    componentIdentities
  );
  const delivered = dependencies.apps.thirdPartyMcpPlans.sessionsAffected(
    input.operationId
  );
  const plans = dependencies.apps.thirdPartyMcpPlans
    .requestIdsHoldingComponents(componentIdentities);
  const prepared = dependencies.coordinator
    .preparedSkillSelections()
    .filter(({ receipt }) =>
      receipt.candidates.some(
        (candidate) =>
          candidate.generationRef.kind === "extension" &&
          projections.installIdentityOfGeneration(
            candidate.generationRef.package
          ) === input.installIdentity
      )
    )
    .map((item) => item.requestId);
  const holders = new Map<string, ExtensionRuntimeHolder>();
  for (const item of [...ambient, ...delivered]) {
    holders.set(`conversation:${item.conversationId}:${item.backend}:${item.sessionId}`, {
      kind: "conversation",
      conversationId: item.conversationId,
      session: { backend: item.backend, id: item.sessionId },
    });
  }
  for (const { requestId } of manual) {
    holders.set(`request:${requestId}`, { kind: "request", requestId });
  }
  for (const requestId of plans) {
    holders.set(`request:${requestId}`, { kind: "request", requestId });
  }
  for (const requestId of prepared) {
    holders.set(`prepared:${requestId}`, {
      kind: "prepared-request",
      requestId,
    });
  }
  return [...holders.values()];
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
    gate
  );
  importer.configureExtensions(extensions.installer);
  const share = new ShareFlow(
    dirname(dependencies.apps.store.appsRoot),
    dependencies.apps.store,
    dependencies.projectStore,
    dependencies.baseStore,
    dependencies.intents,
    gate
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
    removeShell: async (record) => {
      await dependencies.apps.removeBaseShell(record);
      dependencies.apps.emitRemoval(record.id);
    },
    enqueueSkillTurnHeld: (input) => enqueueSkillTurn(input, dependencies),
    locale: dependencies.locale,
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
  dependencies.apps.configureGenerationRetirement((input) => retirement.proof(input));
  const appDelete = new AppDeleteService({
    store: dependencies.apps.store,
    projects: dependencies.projects,
    intents: dependencies.intents,
    gate,
    coordinator: dependencies.coordinator,
    runExclusive: (appId, operation) =>
      dependencies.apps.runAppLifecycleMutation(appId, operation),
    listAppChats: (appId) =>
      dependencies.chatStore
        .list()
        .filter(hasCanonicalChatPlacement)
        .filter(
          (chat) =>
            chat.context.kind !== "ordinary" && chat.context.appId === appId
        )
        .map((chat) => chat.id),
    drainAppTurns: (appId) =>
      dependencies.cancelConversations(
        dependencies.chatStore
          .list()
          .filter(hasCanonicalChatPlacement)
          .filter(
            (chat) =>
              chat.context.kind !== "ordinary" && chat.context.appId === appId
          )
          .map((chat) => chat.id)
      ),
    removeAppChat: (chatId, appId) =>
      dependencies.chats.removeAppChatHeld(chatId, appId),
    promoteRetainedBase: (projectId) =>
      dependencies.bases.promoteRetainedAppBase(projectId).then(() => undefined),
    convertToBaseCustody: (projectId, appId) =>
      dependencies.projects.retainBaseCustodyHeld(projectId, appId).then(() => undefined),
    removeShell: (record) => dependencies.apps.removeBaseShell(record),
    closeAdmission: (appId) => dependencies.apps.closeDeleteAdmission(appId),
    settleBuilds: (appId) => dependencies.apps.settleDeleteBuilds(appId),
    retireGeneration: (appId, generationId) =>
      retirement.proof({ appId, generationId }).then(() => undefined),
    revokeCapabilities: (appId) =>
      dependencies.apps.revokeDeleteCapabilities(appId),
    settleData: (record, mode) =>
      dependencies.apps.settleDeleteData(record, mode),
    finalizeRemoval: (appId) =>
      dependencies.apps.finalizeDelete(appId).then(() => undefined),
    publishRemoval: (appId) => dependencies.apps.emitRemoval(appId),
    reportProgress: (appId) => dependencies.apps.emitDeleteProgress(appId),
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
  chat: ChatMetadata,
  dependencies: AppModeDependencies
) {
  if (!chat.session) return;
  await dependencies.chats.replaceSession(
    { conversationId: chat.id },
    chat.session,
    null
  );
  dependencies.releaseThreadScope(chat.id);
  const current = dependencies.chatStore.getMetadata(chat.id);
  if (!current) return;
  dependencies.chats.publishRecord(current);
  dependencies.chats.publishSessionInvalidated(current);
}

async function restoreSession(
  chat: ChatMetadata,
  session: SessionRef | null,
  dependencies: AppModeDependencies
) {
  const current = dependencies.chatStore.getMetadata(chat.id);
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
  const restored = dependencies.chatStore.getMetadata(chat.id);
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
    chat: ChatMetadata;
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
    await dependencies.projectStore.rename(project.id, name, "app");
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
