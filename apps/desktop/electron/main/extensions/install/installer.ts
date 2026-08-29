/**
 * [INPUT]: Depends on source staging, admission/disclosure, scoped Registry CAS, durable Project resource admission, lifecycle/owner receipts, epoch storage, and App migration ports
 * [OUTPUT]: Provides scope-frozen preflight→Project claim→authorization→seal→activate→migration with crash-released durable admission
 * [POS]: Extension install ordering and trust boundary; confirm accepts only the frozen preflight identity/content receipt and never accepts scope
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { normalizeGithubRepoUrl } from "../../../../shared/github-repo";
import type {
  ExtensionPackageGenerationRef,
  Sha256Digest,
} from "../../../../shared/extensions-ipc";
import {
  productResourceScopeKey,
  type ProductResourceScope,
} from "../../../../shared/product-resource-scope";
import {
  admitAnyExtensionPackage,
  type ExtensionAdapterId,
  type ExtensionAdmission,
} from "../admission";
import { extensionContentStore } from "../content-store";
import type { ExtensionPackageAdmission } from "../manifest-adapter";
import type { ExtensionRegistryStore } from "../registry-store";
import type {
  AuthorizedExtensionInstall,
  ExtensionLifecycleLedger,
  ExtensionLifecycleOperation,
} from "../lifecycle/lifecycle-ledger";
import type { PluginDataEpochStore } from "../lifecycle/plugin-data-epochs";
import {
  diffCapabilities,
  discloseExtensionPackage,
  discloseInstalledGeneration,
  listPackageFiles,
  type ExtensionCapabilityDisclosure,
} from "./disclosure";
import {
  discardStagedSource,
  fetchExtensionSource,
  type ExtensionSourceRequest,
  type StagedExtensionSource,
} from "./source";
import {
  asAdapterId,
  displayNameOf,
  installIdentityOf,
  migrationId,
  namespaceOf,
  sourceIdentityOf,
} from "./install-identity";
import {
  ExtensionInstallResources,
  missingProjectInstallAuthority,
  type ExtensionInstallerFaults,
  type ExtensionProjectInstallAuthority,
} from "./install-resources";

export type { ExtensionCapabilityDisclosure } from "./disclosure";
export type { ExtensionInstallerFaults, ExtensionProjectInstallAuthority } from "./install-resources";
export { installIdentityOf, sourceIdentityOf } from "./install-identity";

/** 取源机制的注入面：回归用真 git 本地仓库换掉远端地址，其余判据一律照走 */
export type ExtensionSourceFetcher = typeof fetchExtensionSource;

/** 更新时仍精确绑定旧代的 App；迁移由用户逐个选择，不迁移就继续用旧代 */
export type ExtensionAffectedApp = Readonly<{
  appId: string;
  appGenerationId: string;
}>;

export type ExtensionAppMigrationPort = Readonly<{
  /**
   * 精确绑定这些 package generation 的 App generation。
   *
   * 传的是**该安装的全部既有代**而不是当前 active 代：连着更新两次时，仍绑在
   * 更早一代上的 App 一样需要迁移，只看 active 会把它们漏掉。
   */
  boundApps(
    refs: readonly ExtensionPackageGenerationRef[]
  ): readonly ExtensionAffectedApp[];
  /** 为该 App 幂等起新 pending 代；migrationId 稳定且可重放。 */
  migrate(appId: string, migrationId: string): Promise<void>;
}>;

/** 只供崩溃窗口回归注入；生产组合根不传即为空。 */
export type ExtensionCapabilityDiff = Readonly<{
  previousGenerationId: string;
  added: readonly string[];
  removed: readonly string[];
  requiresReauthorization: boolean;
}>;

export type ExtensionInstallPreflight = Readonly<{
  preflightId: string;
  contentDigest: Sha256Digest;
  installIdentity: string;
  scope: ProductResourceScope;
  sourceIdentity: string;
  projectLifecycleRevision: number | null;
  scopeRevision: number;
  componentNamespace: string;
  adapterId: ExtensionAdapterId;
  source: StagedExtensionSource["provenance"];
  admission: ExtensionPackageAdmission;
  disclosure: ExtensionCapabilityDisclosure;
  files: StagedExtensionSource["files"];
  /** null = 首装；非 null 即同一 install identity 的新一代 */
  capabilityDiff: ExtensionCapabilityDiff | null;
  affectedApps: readonly ExtensionAffectedApp[];
}>;

type HeldPreflight = ExtensionInstallPreflight & {
  packageRoot: string;
  operationId: string;
  evidence: ExtensionAdmission;
  expectedActiveGenerationRef: ExtensionPackageGenerationRef | null;
};

export type ExtensionInstallRequest = ExtensionSourceRequest & Readonly<{
  scope: ProductResourceScope;
  expectedProjectLifecycleRevision: number | null;
  expectedScopeRevision: number;
}>;

export class ExtensionInstaller {
  private readonly stagingRoot: string;
  /** 内容寻址的包字节根；卸载的字节回收从同一处取，绝不各拼一份路径 */
  readonly packagesRoot: string;
  private readonly contentStore: ReturnType<typeof extensionContentStore>;
  private readonly resources: ExtensionInstallResources;
  private readonly held = new Map<string, HeldPreflight>();
  private readonly lifecycleOwnershipTransfers = new Set<string>();
  private migrations: ExtensionAppMigrationPort | null = null;

  constructor(
    userData: string,
    private readonly registry: ExtensionRegistryStore,
    private readonly ledger: ExtensionLifecycleLedger,
    private readonly epochs: PluginDataEpochStore,
    _legacyValidatorFixtureDigest: Sha256Digest,
    /* 取源是机制、可注入；来源白名单是政策，恒在下面那一行执行。 */
    private readonly fetchSource = fetchExtensionSource,
    private readonly faults: ExtensionInstallerFaults = {},
    private readonly projectAuthority: ExtensionProjectInstallAuthority =
      missingProjectInstallAuthority
  ) {
    void _legacyValidatorFixtureDigest;
    this.stagingRoot = join(userData, "agent-extensions", "staging");
    this.packagesRoot = join(userData, "agent-extensions", "packages");
    this.contentStore = extensionContentStore(this.packagesRoot);
    this.resources = new ExtensionInstallResources(
      registry,
      ledger,
      epochs,
      this.contentStore,
      faults,
      projectAuthority
    );
  }

  configureMigrations(port: ExtensionAppMigrationPort) {
    this.migrations = port;
  }

  scopeRevision(scope: ProductResourceScope) {
    return this.registry.scopeRevision(scope);
  }

  heldAuthorization(preflightId: string) {
    const held = this.held.get(preflightId);
    return held
      ? {
          scope: structuredClone(held.scope),
          projectLifecycleRevision: held.projectLifecycleRevision,
          scopeRevision: held.scopeRevision,
        }
      : null;
  }

  isInstalled(input: {
    declaredComponentIdentity: string;
    scope: ProductResourceScope;
    projectLifecycleRevision: number | null;
    repoUrl: string;
    resolvedCommit: string;
    contentDigest: Sha256Digest;
  }) {
    const inventory = this.registry.ownedInventory(
      input.scope,
      input.projectLifecycleRevision
    );
    const component = inventory.components.find(
      (item) =>
        item.declaredComponentIdentity === input.declaredComponentIdentity
    );
    const owner = inventory.packages.find(
      (item) =>
        item.source.normalizedUrl === input.repoUrl &&
        item.source.resolvedCommit === input.resolvedCommit &&
        item.activeGenerationRef?.packageGenerationId ===
          component?.packageGenerationRef.packageGenerationId
    );
    const generation = owner?.generations.find(
      (item) =>
        item.packageGenerationId === owner.activeGenerationRef?.packageGenerationId &&
        item.recordDigest === owner.activeGenerationRef.recordDigest
    );
    return generation?.contentDigest === input.contentDigest &&
      owner?.administrativeState === "active";
  }

  /**
   * 崩溃恢复由 ledger 驱动，不看「目录在不在」。
   *
   * `sealing` 之后的重放只读 durable 授权快照：未建代就用预分配 id
   * 建代，已建代就复核后续推，每个 App 迁移用稳定 id + checkpoint 重放。
   * `staged` 一律丢弃——用户从未确认。
   */
  async recover() {
    await this.contentStore.reconcile(this.resources.retainedContentDigests());
    /* Aborted preflights still name their content digest. GC is replayed because
       a crash after unlink but before packagesRoot fsync may roll the entry back. */
    for (const operation of this.ledger.snapshot()) {
      if (
        (operation.kind === "install" || operation.kind === "update") &&
        operation.phase === "aborted"
      ) {
        await this.resources.collectStagedContent(operation.contentDigest);
      }
    }
    /* completed 是「不会再写 Registry/Data」的 durable checkpoint；若崩在
       completed→release 之间，启动只释放 Project claim，绝不重放安装。 */
    for (const operation of this.ledger.snapshot()) {
      if (
        (operation.kind === "install" || operation.kind === "update") &&
        operation.phase === "completed"
      ) {
        await this.registry.releaseInstallReservation(operation.operationId);
        await this.resources.releaseProjectAdmission(operation);
      }
    }
    for (const kind of ["install", "update"] as const) {
      for (const operation of this.ledger.nonTerminal(kind)) {
        if (
          operation.authorizedInstall &&
          operation.installAuthorizationState === "committed"
        ) {
          await this.resumeAuthorized(operation.operationId).catch(async (cause) => {
            await this.ledger.block(operation.operationId, {
              code: "seal-incomplete",
              message: cause instanceof Error ? cause.message : String(cause),
            });
            console.warn(
              `[扩展] 已授权的 ${kind} 恢复未完成：${operation.installIdentity}`,
              cause
            );
          });
          continue;
        }
        if (
          operation.authorizedInstall &&
          operation.installAuthorizationState === "prepared"
        ) {
          await this.resumePreparedAuthorization(operation).catch(async (cause) => {
            if (this.registry.installReservation(operation.operationId)) {
              await this.ledger.block(operation.operationId, {
                code: "authorization-incomplete",
                message: cause instanceof Error ? cause.message : String(cause),
              });
            }
          });
          continue;
        }
        /* 旧账本没有 replay payload：若 generation 已落盘，只能沿用
           旧版的保守收口；没落盘则无事实可重放，必须丢弃。 */
        const sealed = this.resources.generationRef(operation.identities.packageGenerationId);
        if (operation.phase === "sealing" && sealed) {
          /* 恢复拿不到那次预检的能力 diff，所以只走最保守的一档：新代回到
             inert，用户重新逐项启用。少启用永远比多启用安全。 */
          await this.registry.activateGeneration(sealed);
          const current = this.ledger.find(operation.operationId)!;
          await this.ledger.advance(
            operation.operationId,
            current.revision,
            "completed"
          );
          await this.registry.releaseInstallReservation(operation.operationId);
          await this.resources.releaseProjectAdmission(operation);
          continue;
        }
        await this.registry.releaseInstallReservation(operation.operationId);
        await this.ledger.abort(operation.operationId);
        await this.resources.collectStagedContent(operation.contentDigest);
        await this.resources.releaseProjectAdmission(operation);
      }
    }
  }

  /**
   * A Project deletion fence freezes pre-existing install claims. Cleanup may
   * abort those exact operations even when ordinary recovery is blocked by the
   * fence; partially sealed generations remain Registry-owned and are removed
   * by the normal disable/uninstall participant that follows.
   */
  async cancelProjectAdmissions(
    projectId: string,
    admissions: readonly Readonly<{
      operationId: string;
      installIdentity: string;
      projectLifecycleRevision: number;
    }>[]
  ) {
    for (const admission of admissions) {
      const operation = this.ledger.find(admission.operationId);
      if (!operation) {
        throw new Error(
          `Project deletion admission 缺少 Extension ledger operation：${admission.operationId}`
        );
      }
      if (
        operation.scope.kind !== "project" ||
        operation.scope.projectId !== projectId ||
        operation.installIdentity !== admission.installIdentity ||
        operation.expectedProjectLifecycleRevision !==
          admission.projectLifecycleRevision
      ) {
        throw new Error("Project deletion admission 与 Extension ledger 不一致");
      }
      for (const [preflightId, held] of this.held) {
        if (held.operationId === operation.operationId) {
          this.held.delete(preflightId);
        }
      }
      if (operation.phase !== "completed" && operation.phase !== "aborted") {
        await this.ledger.abort(operation.operationId);
      }
      await this.registry.releaseInstallReservation(operation.operationId);
      if (operation.phase !== "completed") {
        await this.resources.collectStagedContent(operation.contentDigest);
      }
      await this.projectAuthority.release({
        projectId,
        projectLifecycleRevision: admission.projectLifecycleRevision,
        operationId: admission.operationId,
        installIdentity: admission.installIdentity,
      });
    }
  }

  /* 取源与入库都发生在用户确认之前——admission 必须针对**最终位置**的字节，
     否则 pluginRoot 会指向随后被删除的 staging 目录。启用与交付都不在这里。 */
  async preflight(request: ExtensionInstallRequest): Promise<ExtensionInstallPreflight> {
    const staged = await this.fetchSource(this.stagingRoot, {
      ...request,
      repoUrl: normalizeGithubRepoUrl(request.repoUrl).repoUrl,
    });
    let operationId: string | null = null;
    let contentClaimId: string | null = null;
    try {
      const sourceIdentity = sourceIdentityOf(staged.provenance);
      const installIdentity = installIdentityOf(request.scope, staged.provenance);
      const owner = this.registry.packageInventory(installIdentity);
      const expectedActiveGenerationRef = owner?.activeGenerationRef ?? null;
      this.registry.assertInstallCas(
        installIdentity,
        expectedActiveGenerationRef,
        staged.adapterId,
        request.scope,
        request.expectedScopeRevision
      );
      contentClaimId = await this.contentStore.claim(staged.contentDigest);
      const packageRoot = await this.contentStore.adopt(
        contentClaimId,
        staged.packageRoot,
        staged.contentDigest
      );
      const evidence = await admitAnyExtensionPackage(
        packageRoot,
        staged.provenance,
        staged.adapterId
      );
      const admission = evidence.admission;
      if (!admission.valid) {
        throw new Error(
          `扩展包未通过 ${staged.adapterId} admission：${admission.diagnostics
            .filter((item) => item.severity === "error")
            .map((item) => `${item.path} ${item.message}`)
            .join("；")}`
        );
      }
      const disclosure = await discloseExtensionPackage({
        packageRoot,
        files: await listPackageFiles(packageRoot),
        admission,
      });
      const previous =
        owner?.generations.find(
          (item) =>
            item.packageGenerationId ===
            owner.activeGenerationRef?.packageGenerationId
        ) ?? null;
      const capabilityDiff = previous
        ? {
            previousGenerationId: previous.packageGenerationId,
            ...diffCapabilities(
              await discloseInstalledGeneration({
                packageRoot: this.resources.contentRoot(previous.contentDigest),
                adapterId: asAdapterId(previous.admissionEvidence.adapterId),
                source: this.registry.generationSource(
                  previous.packageGenerationId
                )!,
              }),
              disclosure
            ),
          }
        : null;
      /* 身份先落账再动世界：seal 与 epoch 都按这里预分配的 id 幂等重放。 */
      const operation = await this.ledger.stage({
        kind: previous ? "update" : "install",
        installIdentity,
        scope: request.scope,
        sourceIdentity,
        expectedProjectLifecycleRevision:
          request.expectedProjectLifecycleRevision,
        expectedScopeRevision: request.expectedScopeRevision,
        contentDigest: staged.contentDigest,
        ...(admission.containsStdio ? { pluginDataEpochId: randomUUID() } : {}),
        ...(previous?.dataBinding.kind === "stdio"
          ? { sourceEpochId: previous.dataBinding.pluginDataEpochId }
          : {}),
      });
      operationId = operation.operationId;
      await this.contentStore.releaseClaim(contentClaimId);
      contentClaimId = null;
      const preflight: HeldPreflight = {
        preflightId: randomUUID(),
        operationId: operation.operationId,
        contentDigest: staged.contentDigest,
        installIdentity,
        scope: structuredClone(request.scope),
        sourceIdentity,
        projectLifecycleRevision: request.expectedProjectLifecycleRevision,
        scopeRevision: request.expectedScopeRevision,
        componentNamespace: namespaceOf(staged.provenance),
        adapterId: staged.adapterId,
        source: staged.provenance,
        admission,
        disclosure,
        files: staged.files,
        capabilityDiff,
        affectedApps:
          owner && this.migrations
            ? this.migrations.boundApps(
                owner.generations.map((item) => ({
                  packageGenerationId: item.packageGenerationId,
                  recordDigest: item.recordDigest,
                }))
              )
            : [],
        packageRoot,
        evidence,
        expectedActiveGenerationRef,
      };
      this.held.set(preflight.preflightId, preflight);
      return preflight;
    } catch (cause) {
      let ledgerOutcomeKnown = true;
      try {
        this.ledger.snapshot();
      } catch {
        ledgerOutcomeKnown = false;
      }
      if (operationId && ledgerOutcomeKnown) {
        try {
          await this.ledger.abort(operationId);
        } catch {
          ledgerOutcomeKnown = false;
        }
      }
      if (contentClaimId && ledgerOutcomeKnown) {
        await this.contentStore.releaseClaim(contentClaimId);
        contentClaimId = null;
        await this.resources.collectStagedContent(staged.contentDigest);
      }
      throw cause;
    } finally {
      await discardStagedSource(staged);
    }
  }

  /* 确认只认「同一次预检的同一份字节」：来源或 digest 对不上直接失败，
     绝不在确认阶段重新解析远端——那等于让用户批准了 A、装进去 B。 */
  async confirm(input: {
    preflightId: string;
    expectedContentDigest: Sha256Digest;
    expectedResolvedCommit: string;
    migrateAppIds?: readonly string[];
  }) {
    const held = this.held.get(input.preflightId);
    if (
      !held ||
      held.contentDigest !== input.expectedContentDigest ||
      held.source.resolvedCommit !== input.expectedResolvedCommit
    ) {
      throw Object.assign(new Error("扩展预检已失效或与冻结提交不一致"), {
        status: 409,
      });
    }
    const migrate = input.migrateAppIds ?? [];
    const known = new Set(held.affectedApps.map((item) => item.appId));
    if (migrate.some((appId) => !known.has(appId))) {
      throw new Error("迁移名单包含未受本次更新影响的 App");
    }
    /* Claim ownership synchronously, before the first await. The local held
       token can no longer race Project admission or a durable ledger fsync. */
    this.lifecycleOwnershipTransfers.add(input.preflightId);
    this.held.delete(input.preflightId);
    let projectAdmissionAcquired = held.scope.kind === "global";
    try {
      await this.resources.acquireProjectAdmission(held);
      projectAdmissionAcquired = true;
      const staged = this.ledger.find(held.operationId)!;
      const prepared = await this.ledger.prepareInstallAuthorization(
        held.operationId,
        staged.revision,
        {
          adapterId: held.adapterId,
          componentNamespace: held.componentNamespace,
          scope: held.scope,
          sourceIdentity: held.sourceIdentity,
          expectedProjectLifecycleRevision: held.projectLifecycleRevision,
          expectedScopeRevision: held.scopeRevision,
          source: held.source,
          admission: held.admission,
          evidence: {
            schemaDigest: held.evidence.schemaDigest,
            validatorFixtureDigest: held.evidence.validatorFixtureDigest,
          },
          displayName: displayNameOf(held.admission, held.source),
          expectedActiveGenerationRef: held.expectedActiveGenerationRef,
          preserveEnabled: Boolean(
            held.capabilityDiff && !held.capabilityDiff.requiresReauthorization
          ),
          migrateAppIds: migrate,
        }
      );
      this.lifecycleOwnershipTransfers.delete(input.preflightId);
      await this.faults.beforeReservation?.(held.operationId);
      await this.registry.reserveInstall({
        operationId: held.operationId,
        packageGenerationId: prepared.identities.packageGenerationId,
        installIdentity: held.installIdentity,
        sourceIdentity: held.sourceIdentity,
        scope: held.scope,
        adapterId: held.adapterId,
        expectedScopeRevision: held.scopeRevision,
        expectedActiveGenerationRef: held.expectedActiveGenerationRef,
      });
      await this.faults.afterReserved?.(held.operationId);
      await this.ledger.authorizeInstall(
        held.operationId,
        prepared.revision
      );
    } catch (cause) {
      this.lifecycleOwnershipTransfers.delete(input.preflightId);
      /* A rejected durable write is not proof that its rename did not commit.
         Only a domain conflict is known to happen before Registry persistence;
         I/O failures retain the prepared intent, Project claim, and bytes so a
         fresh process can reconcile the two ledgers. */
      if (
        (cause as { status?: number }).status === 409 &&
        !this.registry.installReservation(held.operationId)
      ) {
        try {
          await this.ledger.abort(held.operationId);
          await this.resources.collectStagedContent(held.contentDigest);
          if (projectAdmissionAcquired) {
            await this.resources.releaseProjectAdmission(held);
          }
        } catch {
          /* Commit outcome is uncertain: keep the Project claim fail-closed.
             Startup reconciliation rereads both durable stores. */
        }
      }
      throw cause;
    }
    /* 授权快照已 fsync，从此不再依赖 renderer 或这份内存 preflight。 */
    try {
      await this.faults.afterAuthorized?.(held.operationId);
      return await this.resumeAuthorized(held.operationId);
    } catch (cause) {
      /* 授权之后的任何一步失败都停在 `sealing` 并把原因说出口：这一代因此保持
         staged/ineligible，恢复按预分配身份续跑，绝不降级成另一种能发布的形态。 */
      await this.ledger.block(held.operationId, {
        code: "seal-incomplete",
        message: cause instanceof Error ? cause.message : String(cause),
      });
      throw cause;
    }
  }

  private async resumeAuthorized(operationId: string) {
    let operation = this.ledger.find(operationId);
    if (!operation?.authorizedInstall || !operation.contentDigest) {
      throw new Error("已授权扩展操作缺少可重放快照");
    }
    this.resources.assertProjectAdmission(operation);
    await this.ensureInstallReservation(operation, operation.authorizedInstall);
    const generation = await this.seal(operation, operation.authorizedInstall);
    await this.faults.afterSealed?.(operationId);
    operation = this.ledger.find(operationId)!;
    for (const appId of operation.authorizedInstall!.migrateAppIds) {
      if (operation.authorizedInstall!.migratedAppIds.includes(appId)) continue;
      if (!this.migrations) throw new Error("App 迁移面未装配");
      await this.migrations.migrate(appId, migrationId(operationId, appId));
      /* 最坏窗口：App 代已落盘，checkpoint 还没落盘。恢复会用
         同一 migrationId 再试，AppStore 必须返回同一代。 */
      await this.faults.afterAppMigrated?.(operationId, appId);
      operation = await this.ledger.recordAppMigration(operationId, appId);
    }
    const settled = this.ledger.find(operationId)!;
    await this.ledger.advance(operationId, settled.revision, "completed");
    await this.registry.releaseInstallReservation(operationId);
    await this.resources.releaseProjectAdmission(operation);
    return generation;
  }

  private async resumePreparedAuthorization(
    operation: ExtensionLifecycleOperation
  ) {
    const replay = operation.authorizedInstall;
    if (!replay || operation.installAuthorizationState !== "prepared") {
      throw new Error("Extension install authorization 未 prepared");
    }
    this.resources.assertProjectAdmission(operation);
    try {
      await this.ensureInstallReservation(operation, replay);
    } catch (cause) {
      if (
        (cause as { status?: number }).status === 409 &&
        !this.registry.installReservation(operation.operationId)
      ) {
        await this.ledger.abort(operation.operationId);
        await this.resources.collectStagedContent(operation.contentDigest);
        await this.resources.releaseProjectAdmission(operation);
      }
      throw cause;
    }
    const current = this.ledger.find(operation.operationId)!;
    await this.ledger.authorizeInstall(operation.operationId, current.revision);
    return this.resumeAuthorized(operation.operationId);
  }

  private ensureInstallReservation(
    operation: ExtensionLifecycleOperation,
    replay: AuthorizedExtensionInstall
  ) {
    return this.registry.reserveInstall({
      operationId: operation.operationId,
      packageGenerationId: operation.identities.packageGenerationId,
      installIdentity: operation.installIdentity,
      sourceIdentity: operation.sourceIdentity,
      scope: operation.scope,
      adapterId: replay.adapterId,
      expectedScopeRevision: replay.expectedScopeRevision,
      expectedActiveGenerationRef: replay.expectedActiveGenerationRef,
    });
  }

  private async seal(
    operation: ExtensionLifecycleOperation,
    replay: NonNullable<ExtensionLifecycleOperation["authorizedInstall"]>
  ) {
    if (
      productResourceScopeKey(operation.scope) !==
        productResourceScopeKey(replay.scope) ||
      operation.sourceIdentity !== replay.sourceIdentity ||
      operation.expectedProjectLifecycleRevision !==
        replay.expectedProjectLifecycleRevision
    ) {
      throw new Error("Extension lifecycle owner receipt 与授权快照不一致");
    }
    await this.epochs.ensureOwner({
      installIdentity: operation.installIdentity,
      scope: replay.scope,
      sourceIdentity: replay.sourceIdentity,
      displayLabel: replay.displayName,
      sourceLabel: replay.source.normalizedUrl,
    });
    const existing = this.resources.generationRecord(
      operation.identities.packageGenerationId
    );
    if (
      existing &&
      (existing.installIdentity !== operation.installIdentity ||
        existing.contentDigest !== operation.contentDigest)
    ) {
      throw new Error("预分配 package generation 与授权快照不一致");
    }
    const generation =
      existing ??
      (await this.registry.sealGeneration({
        packageGenerationId: operation.identities.packageGenerationId,
        installIdentity: operation.installIdentity,
        scope: replay.scope,
        sourceIdentity: replay.sourceIdentity,
        expectedScopeRevision: replay.expectedScopeRevision,
        componentNamespace: replay.componentNamespace,
        contentDigest: operation.contentDigest!,
        source: replay.source,
        admission: replay.admission,
        schemaDigest: replay.evidence.schemaDigest,
        validatorFixtureDigest: replay.evidence.validatorFixtureDigest,
        displayName: replay.displayName,
        expectedActiveGenerationRef: replay.expectedActiveGenerationRef,
        installReservationOperationId: operation.operationId,
        /* 数据绑定必须在 seal 之前闭合，绝不退回 `none` 抢先发布。 */
        dataBinding: await this.resources.bindData(operation, replay),
      }));
    /* active generation 与 enabled 是两件事：前者回答「这个安装当前指向哪一代」，
       后者才是启用。不 activate 的话 inventory 里连 component 都列不出来，用户
       将面对一个没有任何可启用项的包——那不是「默认 inert」，那是装坏了。
       扩权的更新必须重新逐项启用；能力未变才允许沿用旧代的启用集合。 */
    await this.registry.activateGeneration(
      {
        packageGenerationId: generation.packageGenerationId,
        recordDigest: generation.recordDigest,
      },
      {
        preserveEnabled: replay.preserveEnabled,
        enableAll: replay.expectedActiveGenerationRef === null,
        installReservationOperationId: operation.operationId,
      }
    );
    return generation;
  }

  async discard(preflightId: string) {
    if (this.lifecycleOwnershipTransfers.has(preflightId)) return;
    const held = this.held.get(preflightId);
    if (!held) return;
    const operation = this.ledger.find(held.operationId);
    if (
      !operation ||
      operation.phase !== "staged" ||
      operation.installAuthorizationState !== "none" ||
      operation.authorizedInstall ||
      this.registry.installReservation(operation.operationId)
    ) {
      /* Prepared/committed/uncertain operations belong to startup recovery.
         Dropping renderer state is not evidence that either durable store did
         not commit. */
      this.held.delete(preflightId);
      return;
    }
    this.held.delete(preflightId);
    await this.ledger.abort(held.operationId);
    await this.resources.collectStagedContent(held.contentDigest);
  }

}
