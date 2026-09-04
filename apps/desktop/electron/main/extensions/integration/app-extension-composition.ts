/**
 * [INPUT]: Depends on scoped Extension Registry/lifecycle stores, App reservation/grant/build ports, Project context, and retained-data custody
 * [OUTPUT]: Provides AppExtensionIntegration with visible-inventory App binding, lifecycle recovery, exact Project cleanup, delivery custody, and uninstall ports
 * [POS]: App×Extension composition root; each domain keeps its own ledger while this module fixes dependency order and Project cleanup ownership
 */

import type { AppExtensionGenerationPort } from "../../apps/generation/app-extension-generation";
import type { AppGenerationBuildParticipantRegistry } from "../../lifecycle/app-generation-build-participants";
import type { AppGenerationDrainProviderRegistry } from "../../lifecycle/app-generation-drain-providers";
import { VALIDATOR_FIXTURE_DIGEST } from "../admission";
import { ExtensionRegistryStore } from "../registry-store";
import {
  ExtensionInstaller,
  type ExtensionInstallerFaults,
  type ExtensionProjectInstallAuthority,
  type ExtensionSourceFetcher,
} from "../install/installer";
import { ExtensionDisableConvergence } from "../lifecycle/disable-convergence";
import { ExtensionLifecycleLedger } from "../lifecycle/lifecycle-ledger";
import { ExtensionPackageUninstall } from "../lifecycle/package-uninstall";
import { ExtensionProjectionLedger } from "../lifecycle/projection-ledger";
import { PluginDataEpochStore } from "../lifecycle/plugin-data-epochs";
import { McpServerCustodyLedger } from "../lifecycle/mcp-server-custody";
import { ComponentHealthAuthority } from "../component-health";
import {
  AppExtensionBuildParticipant,
  type SealedAppResolutionReader,
} from "./build-participant";
import { AppExtensionGrantStore } from "./grant-store";
import {
  AppExtensionMigrator,
  type AppGenerationMigrationCommand,
} from "./app-migration";
import { AppExtensionReservationLedger } from "./reservation-ledger";
import type { TurnProjectContext } from "../../../../shared/product-resource-scope";
import type { AgentBackendId } from "../../../../shared/agent-ipc";

export type AppExtensionIntegration = Readonly<{
  registry: ExtensionRegistryStore;
  installer: ExtensionInstaller;
  lifecycle: ExtensionLifecycleLedger;
  projections: ExtensionProjectionLedger;
  epochs: PluginDataEpochStore;
  mcpCustody: McpServerCustodyLedger;
  health: ComponentHealthAuthority;
  convergence: ExtensionDisableConvergence;
  uninstall: ExtensionPackageUninstall;
  reservations: AppExtensionReservationLedger;
  grants: AppExtensionGrantStore;
  participant: AppExtensionBuildParticipant;
  contextForApp(appId: string): TurnProjectContext;
  port: AppExtensionGenerationPort;
  cleanupProject(input: {
    projectId: string;
    projectLifecycleRevision: number;
    resourceAdmissions: readonly Readonly<{
      operationId: string;
      installIdentity: string;
      projectLifecycleRevision: number;
    }>[];
  }): Promise<void>;
  initialize(options?: Readonly<{
    afterRegistryInitialize?: () => void | Promise<void>;
  }>): Promise<void>;
}>;

export function createAppExtensionIntegration(input: {
  userData: string;
  readSealedResolution: SealedAppResolutionReader;
  participants: AppGenerationBuildParticipantRegistry;
  drainProviders: AppGenerationDrainProviderRegistry;
  /** Extension 换代后为某个 App 起新 pending 代；未装配即该 App 不可迁移 */
  migrateAppGeneration?: AppGenerationMigrationCommand;
  /** 取源是机制、可注入（回归用真 git 本地仓库）；来源白名单仍在政策层生效 */
  fetchSource?: ExtensionSourceFetcher;
  /** 只供崩溃窗口回归；生产不装配。 */
  installerFaults?: ExtensionInstallerFaults;
  projectContextForApp?: (appId: string) => TurnProjectContext;
  backendForApp?: (appId: string) => AgentBackendId;
  projectInstallAuthority?: ExtensionProjectInstallAuthority;
}): AppExtensionIntegration {
  const registry = new ExtensionRegistryStore(input.userData);
  const lifecycle = new ExtensionLifecycleLedger(input.userData);
  const epochs = new PluginDataEpochStore(registry.dataRoot);
  const mcpCustody = new McpServerCustodyLedger(input.userData, epochs);
  const health = new ComponentHealthAuthority();
  const projections = new ExtensionProjectionLedger(input.userData, registry);
  const convergence = new ExtensionDisableConvergence(
    registry,
    projections,
    lifecycle
  );
  /* validator fixture digest 绑定当前 adapter 的判定口径：换 adapter/fixture
     就是新的 admission 证据，旧 generation 不会被追认。 */
  const installer = new ExtensionInstaller(
    input.userData,
    registry,
    lifecycle,
    epochs,
    VALIDATOR_FIXTURE_DIGEST,
    input.fetchSource,
    input.installerFaults,
    input.projectInstallAuthority
  );
  const reservations = new AppExtensionReservationLedger(input.userData, registry);
  const grants = new AppExtensionGrantStore(input.userData);
  const participant = new AppExtensionBuildParticipant(
    registry,
    reservations,
    input.readSealedResolution,
    input.projectContextForApp,
    input.backendForApp
  );
  const uninstall = new ExtensionPackageUninstall(
    registry,
    projections,
    epochs,
    lifecycle,
    installer.packagesRoot
  );
  /* 更新与卸载共用同一个迁移面：两边都是「在一份把旧 ref 关掉的 authoritative
     snapshot 上重新冻结」，差别只在这份 snapshot 是怎么变成那样的。 */
  const migrator = input.migrateAppGeneration
    ? new AppExtensionMigrator(reservations, input.migrateAppGeneration)
    : null;
  if (migrator) installer.configureMigrations(migrator);
  uninstall.configure({
    ...(migrator ? { migrations: migrator } : {}),
    /* 逐轮 plan lease 登记在 Registry 的 ref 表里（owner 形如 `plan:<id>`），由
       durable references 那一闸负责；这里只回答产品自己 spawn 的扩展进程/
       transport。政策把 stdio 锁死时产品一个都不 spawn，所以零是**推导出来的**
       ——那一位一旦翻开，这里立刻报错要求装真探针，而不是继续报零。 */
    custody: {
      outstanding: (installIdentity) => mcpCustody.outstanding(installIdentity),
    },
  });
  input.participants.register("app-extension", participant);
  input.drainProviders.register("app-extension", {
    count: async (target) => participant.generationDrainCount(target),
  });
  const cleanupProject = async (context: {
    projectId: string;
    projectLifecycleRevision: number;
    resourceAdmissions: readonly Readonly<{
      operationId: string;
      installIdentity: string;
      projectLifecycleRevision: number;
    }>[];
  }) => {
    const scope = { kind: "project", projectId: context.projectId } as const;
    await installer.cancelProjectAdmissions(
      context.projectId,
      context.resourceAdmissions
    );
    for (const owner of registry.packageOwners(scope)) {
      let packageRecord = registry.packageInventory(owner.installIdentity);
      if (!packageRecord) continue;
      if (packageRecord.administrativeState === "active") {
        await convergence.beginDisable({
          installIdentity: owner.installIdentity,
          expectedScope: scope,
          expectedProjectLifecycleRevision: context.projectLifecycleRevision,
          expectedScopeRevision: registry.scopeRevision(scope),
        });
        const pending = convergence.convergenceOf(owner.installIdentity);
        if (pending) {
          throw new Error(
            pending.blocked ?? `Extension disable 仍在收敛：${owner.installIdentity}`
          );
        }
      }
      packageRecord = registry.packageInventory(owner.installIdentity);
      if (!packageRecord) continue;
      await uninstall.begin({
        installIdentity: owner.installIdentity,
        expectedScope: scope,
        expectedProjectLifecycleRevision: context.projectLifecycleRevision,
        expectedScopeRevision: registry.scopeRevision(scope),
      });
      const pending = await uninstall.viewOf(owner.installIdentity);
      if (pending) {
        throw new Error(
          pending.blocked ?? `Extension uninstall 仍在收敛：${owner.installIdentity}`
        );
      }
    }
    for (const owner of await epochs.listOwners(scope)) {
      await uninstall.purgeInstallData({
        installIdentity: owner.installIdentity,
        expectedScope: scope,
        expectedProjectLifecycleRevision: context.projectLifecycleRevision,
        expectedScopeRevision: registry.scopeRevision(scope),
      });
    }
    await registry.removeScopeTombstone(scope);
  };
  return {
    registry,
    installer,
    lifecycle,
    projections,
    epochs,
    mcpCustody,
    health,
    convergence,
    uninstall,
    reservations,
    grants,
    participant,
    contextForApp:
      input.projectContextForApp ??
      (() => ({ projectId: null, projectLifecycleRevision: null })),
    cleanupProject,
    port: {
      handoff: (generationBuildId) => participant.handoff(generationBuildId),
      /* 等价/缩权由 GrantStore 自己证明子集后写 derived；这里不复制那套判定。 */
      decide: async ({ appId, frozenSet, deriveFromGenerationId }) => {
        const decision = await grants.createDecision({
          appId,
          set: frozenSet,
          ...(deriveFromGenerationId
            ? { deriveFromGenerationId }
            : {}),
        });
        return {
          consentDecisionId: decision.decisionId,
          expectedConsentRevision: decision.consentRevision,
          state:
            decision.status === "consent-required"
              ? "consent-required"
              : "ready-to-promote",
        };
      },
      resolveConsent: async (input) => {
        const decision = await grants.decide({
          appId: input.appId,
          decisionId: input.consentDecisionId,
          expectedConsentRevision: input.expectedConsentRevision,
          set: input.frozenSet,
          granted: input.granted,
        });
        return {
          consentDecisionId: decision.decisionId,
          expectedConsentRevision: decision.consentRevision,
          state: "ready-to-promote",
        };
      },
      /* denied 也是终态：它让该代零 grant 地 promote，扩展逐条以 scoped-grant-missing
         被排除；只有 consent-required 与 revoke 才阻止 promote。 */
      promotable: ({ appId, appGenerationId, consentDecisionId, expectedConsentRevision }) => {
        const aggregate = grants.snapshot(appId);
        const decision = aggregate?.decisions.find(
          (item) => item.decisionId === consentDecisionId
        );
        if (
          !aggregate ||
          !decision ||
          decision.pendingAppGenerationId !== appGenerationId ||
          decision.consentRevision !== expectedConsentRevision ||
          decision.status === "consent-required"
        ) {
          return false;
        }
        return !aggregate.revokeTombstones.some(
          (item) => item.appGenerationId === appGenerationId
        );
      },
    },
    initialize: async (options) => {
      await registry.initialize();
      await options?.afterRegistryInitialize?.();
      /* writer gate 必须先从 durable custody 重建并 quarantine，再允许任何更新/
         卸载恢复检查 activeWriters；内存为空从来不是零 writer 证据。 */
      await mcpCustody.initialize();
      await mcpCustody.reconcile();
      await lifecycle.initialize();
      await projections.initialize();
      await grants.initialize();
      await reservations.initialize();
      /* 恢复顺序固定：先把没确认完的安装/更新按预分配身份收口，再继续停用
         收敛，最后才是卸载——反过来会让一条半成品的新代混进收敛的 inventory
         判断里，也会让卸载在「还没 deny 干净」的状态上算引用归零。 */
      await installer.recover();
      await convergence.resume();
      await uninstall.resume();
    },
  };
}
