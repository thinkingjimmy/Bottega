/**
 * [INPUT]: Depends on the installation/source, the measurement is staged bytes, admission registry/disclosure, lifecycle ledger/epoch store, ExtensionRegistryStore and App migration narrow ports
 * [OUTPUT]: Provides ExtensionInstaller: First install and update the same ledger Chemical flow waterline: Pre-check→ Atomic Authorization Quick Shots→ Plug and Replace→ Cut Points→ App by App Migration Checkpoint)
 * [POS]: Installation ordering and source policy**** layer of extensions/install; Admission only answers "Can it be safe to enter the library?" and enabling and delivering does not happen
 */

import { randomUUID } from "node:crypto";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { normalizeGithubRepoUrl } from "../../../../shared/github-repo";
import type {
  ExtensionPackageGenerationRef,
  PackageGenerationDataBinding,
  Sha256Digest,
} from "../../../../shared/extensions-ipc";
import {
  admitAnyExtensionPackage,
  type ExtensionAdapterId,
  type ExtensionAdmission,
} from "../admission";
import type { ExtensionPackageAdmission } from "../manifest-adapter";
import { digestCanonical, type ExtensionRegistryStore } from "../registry-store";
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

export type { ExtensionCapabilityDisclosure } from "./disclosure";

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
export type ExtensionInstallerFaults = Readonly<{
  afterAuthorized?: (operationId: string) => void | Promise<void>;
  afterSealed?: (operationId: string) => void | Promise<void>;
  afterAppMigrated?: (
    operationId: string,
    appId: string
  ) => void | Promise<void>;
}>;

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

export class ExtensionInstaller {
  private readonly stagingRoot: string;
  /** 内容寻址的包字节根；卸载的字节回收从同一处取，绝不各拼一份路径 */
  readonly packagesRoot: string;
  private readonly held = new Map<string, HeldPreflight>();
  private migrations: ExtensionAppMigrationPort | null = null;

  constructor(
    userData: string,
    private readonly registry: ExtensionRegistryStore,
    private readonly ledger: ExtensionLifecycleLedger,
    private readonly epochs: PluginDataEpochStore,
    _legacyValidatorFixtureDigest: Sha256Digest,
    /* 取源是机制、可注入；来源白名单是政策，恒在下面那一行执行。 */
    private readonly fetchSource = fetchExtensionSource,
    private readonly faults: ExtensionInstallerFaults = {}
  ) {
    void _legacyValidatorFixtureDigest;
    this.stagingRoot = join(userData, "agent-extensions", "staging");
    this.packagesRoot = join(userData, "agent-extensions", "packages");
  }

  configureMigrations(port: ExtensionAppMigrationPort) {
    this.migrations = port;
  }

  isInstalled(input: {
    componentIdentity: string;
    repoUrl: string;
    resolvedCommit: string;
    contentDigest: Sha256Digest;
  }) {
    const inventory = this.registry.snapshot();
    const component = inventory.components.find(
      (item) => item.componentIdentity === input.componentIdentity
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
    for (const kind of ["install", "update"] as const) {
      for (const operation of this.ledger.nonTerminal(kind)) {
        if (operation.authorizedInstall) {
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
        /* 旧账本没有 replay payload：若 generation 已落盘，只能沿用
           旧版的保守收口；没落盘则无事实可重放，必须丢弃。 */
        const sealed = this.generationRef(operation.identities.packageGenerationId);
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
          continue;
        }
        await this.ledger.abort(operation.operationId);
        await this.collectStagedContent(operation.contentDigest);
      }
    }
  }

  /* 取源与入库都发生在用户确认之前——admission 必须针对**最终位置**的字节，
     否则 pluginRoot 会指向随后被删除的 staging 目录。启用与交付都不在这里。 */
  async preflight(request: ExtensionSourceRequest): Promise<ExtensionInstallPreflight> {
    const staged = await this.fetchSource(this.stagingRoot, {
      ...request,
      repoUrl: normalizeGithubRepoUrl(request.repoUrl).repoUrl,
    });
    let operationId: string | null = null;
    let adopted = false;
    try {
      const installIdentity = installIdentityOf(staged.provenance);
      const owner = this.registry
        .snapshot()
        .packages.find((item) => item.installIdentity === installIdentity);
      const expectedActiveGenerationRef = owner?.activeGenerationRef ?? null;
      this.registry.assertInstallCas(
        installIdentity,
        expectedActiveGenerationRef,
        staged.adapterId
      );
      const packageRoot = await this.adoptContent(staged);
      adopted = true;
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
                packageRoot: this.contentRoot(previous.contentDigest),
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
        contentDigest: staged.contentDigest,
        ...(admission.containsStdio ? { pluginDataEpochId: randomUUID() } : {}),
        ...(previous?.dataBinding.kind === "stdio"
          ? { sourceEpochId: previous.dataBinding.pluginDataEpochId }
          : {}),
      });
      operationId = operation.operationId;
      const preflight: HeldPreflight = {
        preflightId: randomUUID(),
        operationId: operation.operationId,
        contentDigest: staged.contentDigest,
        installIdentity,
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
      if (operationId) await this.ledger.abort(operationId);
      if (adopted) await this.collectStagedContent(staged.contentDigest);
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
    this.registry.assertInstallCas(
      held.installIdentity,
      held.expectedActiveGenerationRef,
      held.adapterId
    );
    const staged = this.ledger.find(held.operationId)!;
    await this.ledger.authorizeInstall(held.operationId, staged.revision, {
      adapterId: held.adapterId,
      componentNamespace: held.componentNamespace,
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
    });
    /* 授权快照已 fsync，从此不再依赖 renderer 或这份内存 preflight。 */
    this.held.delete(input.preflightId);
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
    return generation;
  }

  private async seal(
    operation: ExtensionLifecycleOperation,
    replay: NonNullable<ExtensionLifecycleOperation["authorizedInstall"]>
  ) {
    const existing = this.generationRecord(
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
        componentNamespace: replay.componentNamespace,
        contentDigest: operation.contentDigest!,
        source: replay.source,
        admission: replay.admission,
        schemaDigest: replay.evidence.schemaDigest,
        validatorFixtureDigest: replay.evidence.validatorFixtureDigest,
        displayName: replay.displayName,
        expectedActiveGenerationRef: replay.expectedActiveGenerationRef,
        /* 数据绑定必须在 seal 之前闭合，绝不退回 `none` 抢先发布。 */
        dataBinding: await this.bindData(operation, replay),
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
      }
    );
    return generation;
  }

  async discard(preflightId: string) {
    const held = this.held.get(preflightId);
    if (!held) return;
    this.held.delete(preflightId);
    await this.ledger.abort(held.operationId);
    await this.collectStagedContent(held.contentDigest);
  }

  /**
   * 含 stdio 的代在 seal 前必须拿到独立 epoch：更新走「暂停源 epoch 新 writer →
   * drain 已签发 lease → fsync 快照建新代 → 恢复源 epoch」，两代此后明确分叉。
   */
  private async bindData(
    operation: ExtensionLifecycleOperation,
    replay: AuthorizedExtensionInstall
  ): Promise<PackageGenerationDataBinding> {
    const epochId = operation.identities.pluginDataEpochId;
    if (!replay.admission.containsStdio || !epochId) return { kind: "none" };
    const sourceEpochId = operation.identities.sourceEpochId;
    if (!sourceEpochId) {
      await this.epochs.ensureEpoch(operation.installIdentity, epochId);
      return { kind: "stdio", pluginDataEpochId: epochId };
    }
    if (await this.epochs.hasEpoch(operation.installIdentity, epochId)) {
      return { kind: "stdio", pluginDataEpochId: epochId };
    }
    this.epochs.pauseWriters(operation.installIdentity, sourceEpochId);
    try {
      await this.epochs.snapshotEpoch({
        installIdentity: operation.installIdentity,
        fromEpochId: sourceEpochId,
        toEpochId: epochId,
      });
    } finally {
      /* 源 epoch 必须恢复：新代能不能发布是新代的事，旧代不该被这次失败连坐。 */
      this.epochs.resumeWriters(operation.installIdentity, sourceEpochId);
    }
    return { kind: "stdio", pluginDataEpochId: epochId };
  }

  /** 内容寻址：同一份字节重复预检天然幂等，中断留下的目录也不会变成脏状态。 */
  private async adoptContent(staged: StagedExtensionSource) {
    const target = this.contentRoot(staged.contentDigest);
    await mkdir(this.packagesRoot, { recursive: true, mode: 0o700 });
    /* 同一份字节已经在受管 store 里（很可能正被某一代引用）：留下它，丢掉
       staged 那份。删掉再 rename 会在那个瞬间把一个活着的包根挖空。 */
    if (await exists(target)) return target;
    await rename(staged.packageRoot, target);
    return target;
  }

  /**
   * 无人引用的 staged 内容才回收。两类引用都算数：已 seal 的代，以及**另一条
   * 还没走完的操作**——同一份字节被预检两次时，放弃其中一次不能把另一次正
   * 指着的包根删掉。
   */
  private async collectStagedContent(contentDigest: Sha256Digest | null) {
    if (!contentDigest) return;
    const sealed = this.registry
      .snapshot()
      .packages.some((item) =>
        item.generations.some((entry) => entry.contentDigest === contentDigest)
      );
    const pending = this.ledger
      .nonTerminal()
      .some((item) => item.contentDigest === contentDigest);
    if (!sealed && !pending) {
      await rm(this.contentRoot(contentDigest), { recursive: true, force: true });
    }
  }

  private contentRoot(contentDigest: string) {
    return join(this.packagesRoot, contentDigest.replace("sha256:", ""));
  }

  private generationRef(
    packageGenerationId: string
  ): ExtensionPackageGenerationRef | null {
    for (const item of this.registry.snapshot().packages) {
      const found = item.generations.find(
        (entry) => entry.packageGenerationId === packageGenerationId
      );
      if (found) {
        return {
          packageGenerationId: found.packageGenerationId,
          recordDigest: found.recordDigest,
        };
      }
    }
    return null;
  }

  private generationRecord(packageGenerationId: string) {
    return this.registry
      .snapshot()
      .packages.flatMap((item) => item.generations)
      .find((item) => item.packageGenerationId === packageGenerationId) ?? null;
  }
}

function migrationId(operationId: string, appId: string) {
  return `extension-migration:${operationId}:${appId}`;
}

function asAdapterId(value: string): ExtensionAdapterId {
  if (value === "agent-plugins-1.0.0-wd" || value === "skill-repo-1.0.0") {
    return value;
  }
  throw new Error(`未知 extension adapter：${value}`);
}

function displayNameOf(
  admission: ExtensionPackageAdmission,
  source: StagedExtensionSource["provenance"]
) {
  const manifestName = admission.manifest.name;
  if (typeof manifestName === "string" && manifestName.trim()) return manifestName;
  const skill = admission.components.find((item) => item.kind === "skill");
  if (skill?.kind === "skill") return skill.name;
  return source.normalizedUrl.replace(/\/$/, "").split("/").at(-1)!.replace(/\.git$/, "");
}

async function exists(path: string) {
  return await access(path).then(
    () => true,
    () => false
  );
}

/* install identity 绑定「来源 + 子目录」而不是内容：同一仓库的新 commit 是同一个
   安装的新一代，不是第二个安装。 */
function installIdentityOf(source: StagedExtensionSource["provenance"]) {
  return digestCanonical([source.normalizedUrl, source.subdirectory]);
}

function namespaceOf(source: StagedExtensionSource["provenance"]) {
  const path = source.normalizedUrl.replace(/^https:\/\//, "");
  return source.subdirectory ? `${path}/${source.subdirectory}` : path;
}
