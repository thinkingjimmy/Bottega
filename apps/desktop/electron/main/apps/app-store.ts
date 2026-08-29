/**
 * [INPUT]: Depends on App store schema/recovery, generation planning/building, shared App contracts, participant ledgers, Base GUI grants, and server cutover ports
 * [OUTPUT]: Provides the AppStore v12 single-writer facade, public generation commands, durable record commits, immutable artifact roots, and a `watch` subscription for every committed record
 * [POS]: Canonical App record and broadcast authority; schema, recovery, and generation sagas live in focused siblings while this facade serializes mutations and prevents stale renderer projections
 */

import {
  copyFile,
  mkdir,
  readFile,
} from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AppRecord,
  BaseGuiCapability,
  BaseGuiCapabilityScopes,
  BaseGuiHostActionCapability,
} from "../../../shared/apps-ipc";
import { errorMessage } from "../errors";
import { SerialQueue } from "../persistence/serial-queue";
import { durableReplaceFile } from "../persistence/durable-json";
import type { AppGenerationBuildLedger } from "./app-generation-build-ledger";
import type {
  AppServerCutoverPort,
  PreparedServerCutover,
} from "./app-server-cutover";
import type { AppExtensionGenerationPort } from "./app-extension-generation";
import type { AppGenerationBuildParticipantRegistry } from "../lifecycle/app-generation-build-participants";
import type { BaseGuiGrantStore } from "./base-gui/grant-store";
import { BaseGuiBuildParticipant } from "./base-gui/build-participant";
import { AppGenerationBuilder } from "./app-generation-builder";
import { AppStoreRecovery } from "./app-store-recovery";
import {
  APP_ID_PATTERN,
  SCHEMA_VERSION,
  appRecordSchema,
  legacyStoreSchema,
  parseStore,
  type StoreFile,
} from "./app-store-schema";
export { sealedContentDigest } from "./app-store-schema";

export class AppStore {
  readonly appsRoot: string;
  readonly artifactsRoot: string;
  readonly filePath: string;
  readonly legacyMigrationPath: string;
  private records = new Map<string, AppRecord>();
  private retiredIds = new Set<string>();
  /* appId → 上次广播出去的序列化记录；`persist()` 用它做差分，谁也不必记得
     「我这次改完要不要发一条」。 */
  private published = new Map<string, string>();
  private readonly watchers = new Set<(record: AppRecord) => void>();
  private readonly queue = new SerialQueue();
  private buildLedger: AppGenerationBuildLedger | null = null;
  private serverCutover: AppServerCutoverPort | null = null;
  private participants: AppGenerationBuildParticipantRegistry | null = null;
  private extensions: AppExtensionGenerationPort | null = null;
  private baseGuiGrants: BaseGuiGrantStore | null = null;
  private baseGuiParticipant: BaseGuiBuildParticipant | null = null;
  private generationCutover:
    | (<T>(appId: string, operation: () => Promise<T>) => Promise<T>)
    | null = null;
  private readonly generationBuilder: AppGenerationBuilder;
  private readonly recovery: AppStoreRecovery;

  constructor(userData: string) {
    this.appsRoot = join(userData, "apps");
    this.artifactsRoot = join(userData, "app-generation-artifacts");
    this.filePath = join(userData, "apps.json");
    this.legacyMigrationPath = join(userData, "apps-v11-migration.json");
    this.generationBuilder = new AppGenerationBuilder({
      artifactsRoot: this.artifactsRoot,
      get: (appId) => this.records.get(appId),
      artifactRoot: (appId, generationId) => this.artifactRoot(appId, generationId),
      commitRecord: (record, appId, previous) =>
        this.commitRecord(record, appId, previous),
      buildLedger: () => this.buildLedger,
      serverCutover: () => this.serverCutover,
      participants: () => this.participants,
      extensions: () => this.extensions,
      baseGuiGrants: () => this.baseGuiGrants,
      baseGuiParticipant: () => this.baseGuiParticipant,
    });
    this.recovery = new AppStoreRecovery({
      records: this.records,
      artifactsRoot: this.artifactsRoot,
      filePath: this.filePath,
      legacyMigrationPath: this.legacyMigrationPath,
      buildLedger: () => this.buildLedger,
      baseGuiGrants: () => this.baseGuiGrants,
      get: (appId) => this.records.get(appId),
      artifactRoot: (appId, generationId) => this.artifactRoot(appId, generationId),
      assertDerivedPaths: (records) => this.assertDerivedPaths(records),
      persist: () => this.persist(),
      commitRecord: (record, appId, previous) => this.commitRecord(record, appId, previous),
      withServerCutover: (appId, compute) => this.withServerCutover(appId, compute),
      enqueue: (operation) => this.queue.enqueue(operation),
    });
  }

  configureGenerationLifecycle(
    buildLedger: AppGenerationBuildLedger,
    serverCutover: AppServerCutoverPort
  ) {
    if (this.buildLedger || this.serverCutover) {
      throw new Error("App generation lifecycle 已配置");
    }
    this.buildLedger = buildLedger;
    this.serverCutover = serverCutover;
  }

  /* 组合根注册；未注册时含 extensionRequirements 的 build 直接 fail closed，
     绝不降级成「当作没有声明」继续发布。 */
  configureExtensionComposition(
    participants: AppGenerationBuildParticipantRegistry,
    extensions: AppExtensionGenerationPort
  ) {
    if (this.participants || this.extensions) {
      throw new Error("App extension composition 已配置");
    }
    this.participants = participants;
    this.extensions = extensions;
    if (this.baseGuiParticipant) {
      participants.register(
        "base-gui",
        this.baseGuiParticipant
      );
    }
  }

  configureBaseGuiGrants(grants: BaseGuiGrantStore) {
    if (this.baseGuiGrants) throw new Error("Base GUI grant store 已配置");
    this.baseGuiGrants = grants;
    this.baseGuiParticipant = new BaseGuiBuildParticipant(grants);
  }

  /** generation publish 的宿主 drain；Store 不认识 BrowserWindow，只认事务边界。 */
  configureGenerationCutover(
    cutover: <T>(appId: string, operation: () => Promise<T>) => Promise<T>
  ) {
    if (this.generationCutover) throw new Error("App generation cutover 已配置");
    this.generationCutover = cutover;
  }

  async initialize() {
    await this.load();
    await this.normalizeStartupStates();
  }

  normalizeStartupStates() {
    return this.recovery.normalizeStartupStates();
  }

  async load() {
    await Promise.all([
      mkdir(this.appsRoot, { recursive: true }),
      mkdir(this.artifactsRoot, { recursive: true, mode: 0o700 }),
    ]);
    let parsed: StoreFile;
    let legacy = false;
    try {
      const result = parseStore(JSON.parse(await readFile(this.filePath, "utf8")));
      parsed = result.file;
      legacy = result.legacy;
      this.assertDerivedPaths(parsed.apps);
    } catch (cause) {
      const error = cause as NodeJS.ErrnoException;
      if (error.code === "ENOENT") return;
      /* 断代/损坏不得把整个 main 拖死：备份留证后按冷启动继续（≡ 首次安装的
         空态路径）。上抛只会让 `appsService.initialize()` 挂掉进程，用户连
         重装 App 的界面都进不去——隔离比 fail-closed 便宜得多。 */
      await copyFile(this.filePath, `${this.filePath}.bak`).catch(() => {});
      console.warn(
        `[apps] apps.json 无法读取，已隔离旧版数据（备份至 ${this.filePath}.bak），Base App 请重装：${errorMessage(cause)}`
      );
      return;
    }

    for (const record of parsed.apps) {
      this.records.set(record.id, structuredClone(record));
      /* 读盘是「采纳既有真相」而非变更：先记入快照，启动期的迁移/归一化才只
         广播它们真正改动的那几条，而不是把整张表当成新闻重播一遍。 */
      this.published.set(record.id, JSON.stringify(record));
    }
    this.retiredIds = new Set([
      ...parsed.retiredIds,
      ...parsed.apps.map((record) => record.id),
    ]);
    const checkpoint = await this.recovery.readLegacyMigrationCheckpoint();
    if (legacy) {
      await durableReplaceFile(
        `${this.filePath}.v11.bak`,
        await readFile(this.filePath, "utf8")
      );
      await this.recovery.migrateLegacyV11(parsed.apps);
    } else if (checkpoint) {
      const backup = legacyStoreSchema.parse(
        JSON.parse(await readFile(`${this.filePath}.v11.bak`, "utf8"))
      );
      this.assertDerivedPaths(backup.apps);
      await this.recovery.migrateLegacyV11(backup.apps, checkpoint);
    } else {
      await this.recovery.reconcileArtifacts();
    }
  }

  /**
   * 记录变更的唯一订阅面。返回退订函数。
   *
   * 曾经每条写入都要在 IPC 层手写配一条 `emit({type:"status"})`，于是任何绕过
   * IPC 的写入路径（工厂 provisioning、installer、runtime、启动自愈）都在重造
   * 同一个 bug：记录已经换代，renderer 还停在成代前那一帧投影。广播资格不该由
   * 调用点的记性决定——它属于写入本身。
   */
  watch(listener: (record: AppRecord) => void) {
    this.watchers.add(listener);
    return () => {
      this.watchers.delete(listener);
    };
  }

  /** active route 只消费此派生路径；workspace `record.dir` 永远不是 generation root。 */
  contentRoot(appId: string, generationId: string) {
    return join(this.artifactRoot(appId, generationId), "runtime");
  }

  artifactRoot(appId: string, generationId: string) {
    return join(this.artifactsRoot, appId, generationId);
  }

  /**
   * 启动期归一化两类「本不该存在」的状态，一次遍历、一次落盘：
   *
   * 1. 上次进程死在 installing/updating 中途 → 定格为对应失败终态，让用户看得见。
   * 2. 幻影 start 失败：只有 static/server 才有 web runtime，因而只有它们能在
   *    `start` 阶段失败。Base App 上的 `phase:"start"` 是调用方越界（曾经由
   *    manifest 缺席时的反向 kind 判据造成）留下的伤疤，不是 App 的健康事实。
   *    字节与代绑定从未变动，故这里原样恢复 ready——不是复活，是抹掉一条不可能
   *    成立的记录，否则 App 会因状态非 ready 而永久失去 surface/授权/Design 资格。
   */
  list() {
    return [...this.records.values()]
      .sort((left, right) => left.addedAt - right.addedAt)
      .map((record) => structuredClone(record));
  }

  get(appId: string) {
    const record = this.records.get(appId);
    return record ? structuredClone(record) : undefined;
  }

  hasRetiredId(appId: string) {
    return this.retiredIds.has(appId);
  }

  async reserveId(appId: string) {
    await this.queue.enqueue(async () => {
      if (!APP_ID_PATTERN.test(appId)) throw new Error("App id 格式无效");
      if (this.retiredIds.has(appId)) throw new Error("App id 已退役");
      this.retiredIds.add(appId);
      try {
        await this.persist();
      } catch (cause) {
        this.retiredIds.delete(appId);
        throw cause;
      }
    });
  }

  async set(
    record: AppRecord,
    options: Readonly<{ generationSourceDir?: string }> = {}
  ) {
    return this.withGenerationCutover(record.id, () =>
      this.withServerCutover(record.id, () => record, {
        sourceDir: options.generationSourceDir,
      })
    );
  }

  /** 普通 update 只提交调用者给出的 AppRecord；绝不读取 workspace、seal 或换代。 */
  async update(
    appId: string,
    updater: (record: AppRecord) => AppRecord
  ) {
    return this.queue.enqueue(() => {
      const current = this.records.get(appId);
      if (!current) throw new Error("App 不存在");
      return this.commitRecord(updater(structuredClone(current)), appId, current);
    });
  }

  /** 构建并发布新 generation 的唯一显式入口；有 active 时必经宿主 GUI drain。 */
  async publishGeneration(
    appId: string,
    updater: (record: AppRecord) => AppRecord,
    options: Readonly<{ generationSourceDir?: string }> = {}
  ) {
    return this.withGenerationCutover(appId, () =>
      this.withServerCutover(
        appId,
        () => {
          const current = this.get(appId);
          if (!current) throw new Error("App 不存在");
          return updater(current);
        },
        { sourceDir: options.generationSourceDir }
      )
    );
  }

  async setDefaultGrant(
    appId: string,
    grant: AppRecord["defaultGrant"]
  ) {
    return this.update(appId, (current) => ({
      ...current,
      defaultGrant: grant ? structuredClone(grant) : null,
      defaultGrantRevision: (current.defaultGrantRevision ?? 0) + 1,
    }));
  }

  /** capability tombstone 已 durable 后，只推进 fence；绝不因 workspace 漂移暗建新代。 */
  async advanceLifecycle(appId: string) {
    return this.queue.enqueue(async () => {
      const current = this.records.get(appId);
      if (!current) throw new Error("App 不存在");
      return this.commitRecord(
        { ...current, lifecycleRevision: current.lifecycleRevision + 1 },
        appId,
        current
      );
    });
  }

  /**
   * Extension 更新后的 App 迁移入口（`08-09-app-extension-integration.md` §8.2）。
   *
   * 即使 manifest 一个字节都没变，也必须是**新的一代**：新 generationId、在新
   * inventory 上重新冻结的 requirement graph、新代 scoped grants。旧代与旧
   * grant 继续指向旧 package ref，绝不原地换绑——原地换绑会让一份已授权的
   * frozen graph 悄悄漂到用户没批准过的字节上。
   */
  async migrateGeneration(appId: string, migrationId: string) {
    if (!migrationId.trim()) throw new Error("App generation migrationId 无效");
    return this.withGenerationCutover(appId, () =>
      this.withServerCutover(
        appId,
        () => {
          const current = this.get(appId);
          if (!current) throw new Error("App 不存在");
          if (!current.manifest?.extensionRequirements?.length) {
            throw new Error("该 App 没有 extension 声明，无需迁移");
          }
          return current;
        },
        { migrationId }
      )
    );
  }

  private withGenerationCutover<T>(
    appId: string,
    operation: () => Promise<T>
  ) {
    return this.records.get(appId)?.generationBinding.active && this.generationCutover
      ? this.generationCutover(appId, operation)
      : operation();
  }

  /**
   * §3.4 的顺序在这里成立：**队列外**先按当前快照预判「这次写入会不会产生
   * 一代新的 active server generation」，是就先跑完关准入/撤 route/drain/stop/
   * 造 target epoch，然后才进队列做那个短临界区的整体 CAS。
   *
   * 把等待搬进队列会让 Store queue 反向持住 lifecycle gate（D26 明令 fail-fast），
   * 把 CAS 搬出队列则会让两次写入交叉——所以两者必须在这里分开。
   */
  private async withServerCutover(
    appId: string,
    compute: () => AppRecord,
    options: GenerationPlanOptions = {}
  ) {
    const current = this.records.get(appId);
    const defaultBuildId = `build-${appId}-${(current?.lifecycleRevision ?? 0) + 1}`;
    const plannedOptions =
      !options.migrationId && this.buildLedger?.isRetired(defaultBuildId)
        ? {
            ...options,
            identitySuffix: randomUUID().replaceAll("-", "").slice(0, 16),
          }
        : options;
    const preview = await planGeneration(
      compute(),
      current,
      plannedOptions
    );
    const prepared =
      preview && needsServerEpoch(preview) && this.serverCutover
        ? await this.serverCutover.prepare({
            appId,
            generationBuildId: preview.generationBuildId,
            generationId: preview.generationId,
          })
        : null;
    try {
      const committed = await this.queue.enqueue(() =>
        this.generationBuilder.set(compute(), prepared, plannedOptions)
      );
      await prepared?.commit();
      return committed;
    } catch (cause) {
      await prepared?.abort();
      throw cause;
    }
  }

  /* 用户对该 pending 代的同意/拒绝：GrantStore 单 commit 写 exact grant set，
     AppRecord 只跟随更新 decision 指针，绝不自己解释授权。 */
  async resolvePendingConsent(appId: string, granted: boolean) {
    return this.queue.enqueue(async () => {
      const current = this.get(appId);
      const pending = current?.generationBinding.pending;
      if (!current || !pending) throw new Error("App 没有待同意的 generation");
      const resolution = current.generations.find(
        (item) => item.generationId === pending.generationId
      )?.extensionRequirementResolution;
      if (resolution?.kind !== "frozen" || !this.extensions) {
        throw new Error("pending generation 未冻结 extension resolution");
      }
      const consent = await this.extensions.resolveConsent({
        appId,
        frozenSet: resolution.frozenSet,
        consentDecisionId: pending.consentDecisionId,
        expectedConsentRevision: pending.expectedConsentRevision,
        granted,
      });
      const nextPending = {
        ...pending,
        ...consent,
        extensionState: consent.state,
      };
      nextPending.state = allParticipantsPromotable(nextPending)
        ? "ready-to-promote"
        : "consent-required";
      return this.commitRecord(
        {
          ...current,
          generationBinding: {
            ...current.generationBinding,
            pending: nextPending,
          },
        },
        appId,
        current
      );
    });
  }


  async resolvePendingBaseGuiConsent(
    appId: string,
    grantedCapabilities: readonly BaseGuiCapability[],
    grantedHostActions: readonly BaseGuiHostActionCapability[] = [],
    grantedCapabilityScopes: BaseGuiCapabilityScopes = {}
  ) {
    return this.queue.enqueue(async () => {
      const current = this.get(appId);
      const pending = current?.generationBinding.pending;
      const pointer = pending?.baseGuiDecision;
      const generation = current?.generations.find(
        (item) => item.generationId === pending?.generationId
      );
      if (!current || !pending || !pointer || !generation || !this.baseGuiGrants) {
        throw new Error("App 没有待处理的 Base GUI capability decision");
      }
      const decision = await this.baseGuiGrants.decide({
        appId,
        generationId: generation.generationId,
        decisionId: pointer.decisionId,
        expectedRevision: pointer.expectedRevision,
        contentDigest: generation.contentDigest,
        grantedCapabilities,
        grantedHostActions,
        grantedCapabilityScopes,
      });
      if (decision.state === "declined") {
        // participant tombstone 是资源释放的提交点；AppRecord 只能在它之后删 pending。
        // 反过来会让崩溃后的 ledger 失去可重试的 generation 定位信息。
        await this.generationBuilder.abortGenerationBuild(appId, generation);
        const declined = {
          ...current,
          lifecycleRevision: current.lifecycleRevision + 1,
          generations: current.generations.filter(
            (item) => item.generationId !== pending.generationId
          ),
          generationBinding: {
            ...current.generationBinding,
            bindingRevision: current.generationBinding.bindingRevision + 1,
            pending: undefined,
          },
        };
        const committed = await this.commitRecord(declined, appId, current);
        await this.generationBuilder.discardArtifact(appId, pending.generationId);
        return committed;
      }
      const nextPending = {
        ...pending,
        ...(generation.extensionRequirementResolution.kind === "none"
          ? {
              consentDecisionId: decision.decisionId,
              expectedConsentRevision: decision.revision,
            }
          : {}),
        baseGuiDecision: decisionPointer(decision),
      };
      nextPending.state = allParticipantsPromotable(nextPending)
        ? "ready-to-promote"
        : "consent-required";
      return this.commitRecord(
        {
          ...current,
          generationBinding: {
            ...current.generationBinding,
            pending: nextPending,
          },
        },
        appId,
        current
      );
    });
  }

  /** Main-owned maintenance rollback before promotion; active bytes never move. */
  async abortPendingGeneration(appId: string, generationId: string) {
    return this.queue.enqueue(async () => {
      const current = this.get(appId);
      const pending = current?.generationBinding.pending;
      const generation = current?.generations.find(
        (item) => item.generationId === generationId
      );
      if (!current || pending?.generationId !== generationId || !generation) {
        throw conflict("App pending generation 已变化");
      }
      await this.generationBuilder.abortGenerationBuild(appId, generation);
      const saved = await this.commitRecord(
        {
          ...current,
          lifecycleRevision: current.lifecycleRevision + 1,
          generations: current.generations.filter(
            (item) => item.generationId !== generationId
          ),
          generationBinding: {
            ...current.generationBinding,
            bindingRevision: current.generationBinding.bindingRevision + 1,
            pending: undefined,
          },
        },
        appId,
        current
      );
      await this.generationBuilder.discardArtifact(appId, generationId).catch(() => undefined);
      return saved;
    });
  }

  /* pending→active 的唯一入口：复核 build/reservation/decision 三份证据后才 CAS。
     旧 active 只进 draining，回收仍由统一 retirement coordinator 决定。 */
  async promotePendingGeneration(appId: string, expectedConsentRevision: number) {
    /* pending 的 server 代同样是「新的 active writer」：它必须先经过与普通
       更新完全相同的 drain/stop/隔离构造，才谈得上 CAS。 */
    const pendingBefore = this.get(appId)?.generationBinding.pending;
    const generationBefore = this.get(appId)?.generations.find(
      (item) => item.generationId === pendingBefore?.generationId
    );
    const prepared =
      pendingBefore &&
      generationBefore?.manifest.kind === "server" &&
      this.serverCutover
        ? await this.serverCutover.prepare({
            appId,
            generationBuildId: generationBefore.generationBuildId,
            generationId: pendingBefore.generationId,
          })
        : null;
    try {
      const promoted = await this.promoteUnlocked(
        appId,
        expectedConsentRevision,
        prepared
      );
      await prepared?.commit();
      return promoted;
    } catch (cause) {
      await prepared?.abort();
      throw cause;
    }
  }

  private async promoteUnlocked(
    appId: string,
    expectedConsentRevision: number,
    prepared: PreparedServerCutover | null
  ) {
    return this.queue.enqueue(async () => {
      const current = this.get(appId);
      const pending = current?.generationBinding.pending;
      if (!current || !pending) throw new Error("App 没有待 promote 的 generation");
      if (
        pending.expectedActiveGenerationId !==
        (current.generationBinding.active?.generationId ?? null)
      ) {
        throw conflict("active generation 已变化，pending 失效");
      }
      if (pending.expectedConsentRevision !== expectedConsentRevision) {
        throw conflict("App extension consent revision 已变化");
      }
      const generation = current.generations.find(
        (item) => item.generationId === pending.generationId
      );
      if (!generation) throw new Error("pending generation 不存在");
      if (generation.extensionRequirementResolution.kind === "frozen") {
        if (
          !this.extensions?.promotable({
            appId,
            appGenerationId: pending.generationId,
            consentDecisionId: pending.consentDecisionId,
            expectedConsentRevision,
          })
        ) {
          throw conflict("App extension consent 尚未终结或已被撤销");
        }
      }
      if (pending.baseGuiDecision) {
        if (
          !this.baseGuiGrants?.promotable({
            appId,
            generationId: generation.generationId,
            contentDigest: generation.contentDigest,
            decisionId: pending.baseGuiDecision.decisionId,
            expectedRevision: pending.baseGuiDecision.expectedRevision,
          })
        ) {
          throw conflict("Base GUI capability consent 尚未终结或已被撤销");
        }
      }
      if (generation.manifest.kind === "server" && this.serverCutover) {
        if (!prepared || prepared.generationId !== pending.generationId) {
          throw conflict("server data cutover 与本次 promote 不匹配");
        }
      }
      const promoted = await this.commitRecord(
        promoteBinding(current, generation, pending, prepared?.dataEpochId),
        appId,
        current
      );
      const operation = this.buildLedger
        ?.listNonTerminal(appId)
        .find((item) => item.generationBuildId === generation.generationBuildId);
      if (operation) {
        await this.buildLedger!.advance(
          operation.generationBuildId,
          operation.revision,
          "promoted"
        );
      }
      return promoted;
    });
  }

  async remove(appId: string) {
    await this.queue.enqueue(async () => {
      const current = this.records.get(appId);
      if (!current) return;
      this.records.delete(appId);
      try {
        await this.persist();
      } catch (cause) {
        this.records.set(appId, current);
        throw cause;
      }
      for (const generation of current.generations) {
        await this.generationBuilder.discardArtifact(appId, generation.generationId).catch(() => {});
      }
    });
  }

  async closeAndFlush() {
    this.queue.close();
    await this.queue.flush();
  }

  reopen() {
    this.queue.reopen();
  }

  async commitRecord(
    next: AppRecord,
    appId: string,
    previous: AppRecord | undefined
  ) {
    if (next.generations.some((item) => item.contentLayoutVersion !== 2)) {
      throw new Error("AppStore 只允许提交 v2 generation");
    }
    appRecordSchema.parse(next);
    this.assertDerivedPaths([next]);
    this.records.set(appId, structuredClone(next));
    try {
      await this.persist();
    } catch (cause) {
      if (previous) this.records.set(appId, previous);
      else this.records.delete(appId);
      throw cause;
    }
    return this.get(appId)!;
  }

  private assertDerivedPaths(records: AppRecord[]) {
    for (const record of records) {
      const expected = normalize(join(this.appsRoot, record.id));
      if (
        !isAbsolute(record.dir) ||
        normalize(record.dir) !== expected ||
        relative(this.appsRoot, expected).startsWith("..")
      ) {
        throw new Error(`App ${record.id} 的目录不受 userData/apps 管理`);
      }
    }
  }

  private async persist() {
    const apps = this.list();
    const content = JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        apps,
        retiredIds: [...this.retiredIds].sort(),
      },
      null,
      2
    );
    await durableReplaceFile(this.filePath, `${content}\n`);
    this.announce(apps);
  }

  /**
   * 落盘之后才广播：订阅者见到的每一帧都已经是 durable 的真相，回滚路径（persist
   * 抛错 → 内存还原）天然一条都发不出去。
   *
   * 差分而非「谁改谁喊」：只要一次写入进了 apps.json，它就必然经过这里，广播资格
   * 与写入路径彻底解耦——这是让「忘记 emit」这个分支消失，而不是让它更容易写对。
   * 删除只从快照里除名，`removed` 是另一条语义、由 delete 域自己负责。
   */
  private announce(apps: readonly AppRecord[]) {
    const alive = new Set(apps.map((record) => record.id));
    for (const id of [...this.published.keys()]) {
      if (!alive.has(id)) this.published.delete(id);
    }
    for (const record of apps) {
      const serialized = JSON.stringify(record);
      if (this.published.get(record.id) === serialized) continue;
      this.published.set(record.id, serialized);
      for (const watcher of this.watchers) {
        /* 一个订阅者炸了不能连累落盘已成事实的其余广播。 */
        try {
          watcher(structuredClone(record));
        } catch (cause) {
          console.warn(`[apps] AppRecord 广播失败：${errorMessage(cause)}`);
        }
      }
    }
  }
}

import {
  allParticipantsPromotable,
  conflict,
  decisionPointer,
  needsServerEpoch,
  planGeneration,
  promoteBinding,
  type GenerationPlanOptions,
} from "./app-generation-plan";
