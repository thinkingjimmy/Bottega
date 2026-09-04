/**
 * [INPUT]: Depends on App store schema/recovery, durable JSON quarantine/replacement, static-v2/compiled-v3 generation planning/building, the Studio grant command leaf, shared App contracts, participant ledgers, Base GUI grants, compiler service, and server cutover ports
 * [OUTPUT]: Provides the AppStore v15-only single-writer facade, clone-free routing facts, foreign-schema quarantine with empty-catalog cold start, startup authority repair barrier, Editor/Use/source facts, generation-bound Studio grants, durable commits/retirement, immutable artifact roots, bounded artifact collection, and record subscriptions
 * [POS]: Canonical App record and broadcast authority; schema, recovery, generation sagas, and policy commands live in focused siblings while this facade serializes mutations and prevents stale renderer projections
 */

import { mkdir, readFile } from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AppRecord,
  BaseGuiCapability,
  BaseGuiCapabilityScopes,
  BaseGuiHostActionCapability,
} from "../../../../shared/apps-ipc";
import { errorMessage } from "../../errors";
import { SerialQueue } from "../../persistence/serial-queue";
import {
  durableReplaceFile,
  quarantineDurableFile,
} from "../../persistence/durable-json";
import type { AppGenerationBuildLedger } from "../generation/app-generation-build-ledger";
import type {
  AppServerCutoverPort,
} from "../server/app-server-cutover";
import type { AppExtensionGenerationPort } from "../generation/app-extension-generation";
import type { AppGenerationBuildParticipantRegistry } from "../../lifecycle/app-generation-build-participants";
import type { BaseGuiGrantStore } from "../base-gui/grant-store";
import { BaseGuiBuildParticipant } from "../base-gui/build-participant";
import { AppGenerationBuilder } from "../generation/app-generation-builder";
import { AppGenerationConsentController } from "../generation/app-generation-consent";
import { AppStoreRecovery } from "./app-store-recovery";
import {
  needsServerEpoch,
  planGeneration,
  type GenerationPlanOptions,
} from "../generation/app-generation-plan";
import { grantStudioAccess } from "./studio-grant";
import { appRoutingFacts } from "../support";
import type { AppGuiBuildService } from "../gui-build/service";
import {
  AppStoreAuthorityEvidence,
  type AppStoreAuthorityInspection,
} from "./app-store-authority";
import {
  APP_ID_PATTERN,
  SCHEMA_VERSION,
  appRecordSchema,
  parseStore,
} from "./app-store-schema";
export { sealedContentDigest } from "./app-store-schema";

export type AppStoreAuthorityState =
  | "established-empty"
  | "established"
  | "degraded-corrupt";

export class AppStore {
  readonly appsRoot: string;
  readonly artifactsRoot: string;
  readonly filePath: string;
  readonly authorityMarkerPath: string;
  private records = new Map<string, AppRecord>();
  private authority: AppStoreAuthorityState = "degraded-corrupt";
  private authorityInspection: AppStoreAuthorityInspection | null = null;
  private freshInstallPendingLoad = false;
  private retiredIds = new Set<string>();
  /* appId → 上次广播出去的序列化记录；`persist()` 用它做差分，谁也不必记得
     「我这次改完要不要发一条」。 */
  private published = new Map<string, string>();
  private readonly watchers = new Set<(record: AppRecord) => void>();
  private readonly queue = new SerialQueue();
  private readonly artifactRootProviders = new Set<() => readonly Readonly<{ appId: string; generationId: string }>[] >();
  private readonly retainedArtifactRoots = new Map<string, number>();
  private buildLedger: AppGenerationBuildLedger | null = null;
  private serverCutover: AppServerCutoverPort | null = null;
  private participants: AppGenerationBuildParticipantRegistry | null = null;
  private extensions: AppExtensionGenerationPort | null = null;
  private baseGuiGrants: BaseGuiGrantStore | null = null;
  private baseGuiParticipant: BaseGuiBuildParticipant | null = null;
  private appGuiCompiler: AppGuiBuildService | null = null;
  private generationCutover:
    | (<T>(appId: string, operation: () => Promise<T>) => Promise<T>)
    | null = null;
  private readonly generationBuilder: AppGenerationBuilder;
  private readonly generationConsent: AppGenerationConsentController;
  private readonly recovery: AppStoreRecovery;
  private readonly authorityEvidence: AppStoreAuthorityEvidence;

  constructor(userData: string) {
    this.appsRoot = join(userData, "apps");
    this.artifactsRoot = join(userData, "app-generation-artifacts");
    this.filePath = join(userData, "apps.json");
    this.authorityEvidence = new AppStoreAuthorityEvidence(userData);
    this.authorityMarkerPath = this.authorityEvidence.markerPath;
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
      appGuiCompiler: () => this.appGuiCompiler,
    });
    this.generationConsent = new AppGenerationConsentController({
      get: (appId) => this.get(appId),
      enqueue: (operation) => this.queue.enqueue(operation),
      commitRecord: (record, appId, previous) =>
        this.commitRecord(record, appId, previous),
      extension: () => this.extensions,
      grants: () => this.baseGuiGrants,
      builder: this.generationBuilder,
      serverCutover: () => this.serverCutover,
      buildLedger: () => this.buildLedger,
    });
    this.recovery = new AppStoreRecovery({
      records: this.records,
      artifactsRoot: this.artifactsRoot,
      buildLedger: () => this.buildLedger,
      artifactRoot: (appId, generationId) => this.artifactRoot(appId, generationId),
      persist: () => this.persist(),
      commitRecord: (record, appId, previous) => this.commitRecord(record, appId, previous),
      artifactRoots: () => this.artifactRoots(),
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

  configureAppGuiCompiler(compiler: AppGuiBuildService) {
    if (this.appGuiCompiler) throw new Error("App GUI compiler 已配置");
    this.appGuiCompiler = compiler;
  }

  initializeAppGuiCompiler() {
    if (!this.appGuiCompiler) throw new Error("App GUI compiler is not configured");
    return this.appGuiCompiler.initialize();
  }

  registerArtifactRootProvider(
    provider: () => readonly Readonly<{ appId: string; generationId: string }>[]
  ) {
    this.artifactRootProviders.add(provider);
    return () => this.artifactRootProviders.delete(provider);
  }

  retainArtifactRoot(appId: string, generationId: string) {
    const key = `${appId}/${generationId}`;
    this.retainedArtifactRoots.set(key, (this.retainedArtifactRoots.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.retainedArtifactRoots.get(key) ?? 1) - 1;
      if (count > 0) this.retainedArtifactRoots.set(key, count);
      else this.retainedArtifactRoots.delete(key);
    };
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

  async inspectAuthority() {
    await Promise.all([
      mkdir(this.appsRoot, { recursive: true }),
      mkdir(this.artifactsRoot, { recursive: true, mode: 0o700 }),
    ]);
    const emptyContent = `${JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      apps: [],
      retiredIds: [],
    }, null, 2)}\n`;
    const inspection = await this.authorityEvidence.inspectCanonical({
      filePath: this.filePath,
      emptyContent,
      validate: (content) => {
        const parsed = parseStore(JSON.parse(content));
        this.assertDerivedPaths(parsed.apps);
        return parsed.apps.length;
      },
    });
    this.authorityInspection = inspection;
    this.authority = inspection.state;
    this.freshInstallPendingLoad ||= inspection.initializedNow;
    return this.authority;
  }

  normalizeStartupStates() {
    return this.recovery.normalizeStartupStates();
  }

  async load() {
    await this.quarantineForeignSchema();
    if ((await this.inspectAuthority()) === "degraded-corrupt") return;
    const freshInstall = this.freshInstallPendingLoad;
    const parsed = parseStore(JSON.parse(await readFile(this.filePath, "utf8")));
    this.assertDerivedPaths(parsed.apps);
    this.authority = parsed.apps.length ? "established" : "established-empty";

    for (const record of parsed.apps) {
      this.records.set(record.id, structuredClone(record));
      /* 读盘是「采纳既有真相」而非变更：先记入快照，启动期的归一化才只广播
         它们真正改动的那几条，而不是把整张表当成新闻重播一遍。 */
      this.published.set(record.id, JSON.stringify(record));
    }
    this.retiredIds = new Set([
      ...parsed.retiredIds,
      ...parsed.apps.map((record) => record.id),
    ]);
    if (!freshInstall) await this.recovery.reconcileArtifacts();
    this.freshInstallPendingLoad = false;
  }

  /**
   * 非 v15 是断代不是损坏：隔离留证 + 空目录冷启动，与 build ledger / grant store
   * 走同一条路径。读不出或解析不出的字节留给 authority 的 Repair 面处理——那才是
   * 「损坏」，需要 receipt 才准覆盖。
   *
   * 必须真的把空目录写回去：`inspectCanonical` 只在 catalog 与 marker 双双缺席时
   * 自举，隔离后留一个空洞会被判成 degraded 而锁死写入。
   */
  private async quarantineForeignSchema() {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch {
      return;
    }
    const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
    if (version === SCHEMA_VERSION) return;
    console.warn(
      `[apps] apps.json schemaVersion ${String(version)} 不是 v${SCHEMA_VERSION}，隔离原件后按空目录冷启动`
    );
    await quarantineDurableFile(this.filePath);
    await durableReplaceFile(
      this.filePath,
      `${JSON.stringify(
        { schemaVersion: SCHEMA_VERSION, apps: [], retiredIds: [] },
        null,
        2
      )}\n`
    );
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

  /** 对外的读取面按值交付：调用方拿到的是副本，改不动 Store 里的真相。 */
  list() {
    return this.snapshot().map((record) => structuredClone(record));
  }

  authorityState(): AppStoreAuthorityState {
    return this.authority;
  }

  /** Repair 只提交磁盘证据；当前实例保持写屏障，必须由新进程重新验权。 */
  async repairAuthority() {
    await this.queue.enqueue(async () => {
      if (this.authority !== "degraded-corrupt") return;
      if (!this.authorityInspection) throw new Error("App authority 尚未完成检查");
      const content = JSON.stringify(
        { schemaVersion: SCHEMA_VERSION, apps: [], retiredIds: [] },
        null,
        2
      );
      await this.authorityEvidence.repairCanonical({
        filePath: this.filePath,
        emptyContent: `${content}\n`,
        inspection: this.authorityInspection,
      });
    });
  }

  get(appId: string) {
    const record = this.records.get(appId);
    return record ? structuredClone(record) : undefined;
  }

  /* 路由判定发生在每一次网关请求、每一次 Base API 调用上；为了读四个字段而
     structuredClone 整条记录（含 generations/manifest/receipt）是纯粹的浪费。
     事实是只读派生，按记录对象身份记忆，提交换对象即失效。 */
  routingFacts(appId: string) {
    const record = this.records.get(appId);
    return record ? appRoutingFacts(record) : undefined;
  }

  hasRetiredId(appId: string) {
    return this.retiredIds.has(appId);
  }

  async reserveId(appId: string) {
    this.assertWritableAuthority();
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
    options: Readonly<{
      generationSourceDir?: string;
    }> = {}
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
    this.assertWritableAuthority();
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

  /**
   * Studio grant 只从 sealed manifest 与 main-owned Base GUI decision 推导。
   * renderer 不能提交 data level/capability 列表，因而没有越权参数可伪造。
   */
  async grantStudioAccess(appId: string, generationId: string) {
    this.assertWritableAuthority();
    return this.queue.enqueue(() => grantStudioAccess({
      get: (id) => this.get(id),
      grants: this.baseGuiGrants,
      commit: (next, id, previous) => this.commitRecord(next, id, previous),
    }, appId, generationId));
  }

  async revokeStudioAccess(appId: string) {
    return this.update(appId, (current) => ({
      ...current,
      studioGrant: null,
      studioGrantRevision: (current.studioGrantRevision ?? 0) + 1,
    }));
  }

  async setPinned(appId: string, pinned: boolean, now = Date.now()) {
    return this.update(appId, (current) => ({
      ...current,
      pinnedAt: pinned ? current.pinnedAt ?? now : null,
    }));
  }

  /** capability tombstone 已 durable 后，只推进 fence；绝不因 workspace 漂移暗建新代。 */
  async advanceLifecycle(appId: string) {
    this.assertWritableAuthority();
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
    this.assertWritableAuthority();
    const current = this.records.get(appId);
    const stagesBaseGui = current?.manifest?.kind === "base" && Boolean(current.manifest.gui);
    return current?.generationBinding.active && this.generationCutover && !stagesBaseGui
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
    this.assertWritableAuthority();
    const current = this.records.get(appId);
    const defaultBuildId = `build-${appId}-${(current?.lifecycleRevision ?? 0) + 1}`;
    const plannedOptions =
      !options.migrationId && this.buildLedger?.isRetired(defaultBuildId)
        ? {
            ...options,
            identitySuffix: randomUUID().replaceAll("-", "").slice(0, 16),
          }
        : options;
    const candidate = compute();
    const compiled = candidate.manifest?.kind === "base" && Boolean(candidate.manifest.gui?.build);
    const preview = compiled
      ? null
      : await planGeneration(candidate, current, plannedOptions);
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
    this.assertWritableAuthority();
    return this.generationConsent.resolveExtension(appId, granted);
  }
  async resolvePendingBaseGuiConsent(
    appId: string,
    grantedCapabilities: readonly BaseGuiCapability[],
    grantedHostActions: readonly BaseGuiHostActionCapability[] = [],
    grantedCapabilityScopes: BaseGuiCapabilityScopes = {}
  ) {
    this.assertWritableAuthority();
    return this.generationConsent.resolveBaseGui(
      appId,
      grantedCapabilities,
      grantedHostActions,
      grantedCapabilityScopes
    );
  }

  /** Main-owned maintenance rollback before promotion; active bytes never move. */
  async abortPendingGeneration(appId: string, generationId: string) {
    this.assertWritableAuthority();
    return this.generationConsent.abort(appId, generationId);
  }

  /* pending→active 的唯一入口：复核 build/reservation/decision 三份证据后才 CAS。
     旧 active 只进 draining，回收仍由统一 retirement coordinator 决定。 */
  async promotePendingGeneration(appId: string, expectedConsentRevision: number) {
    this.assertWritableAuthority();
    const current = this.get(appId);
    const pending = current?.generationBinding.pending;
    const generation = current?.generations.find(
      (item) => item.generationId === pending?.generationId
    );
    if (
      this.generationCutover &&
      generation?.manifest.kind === "base" &&
      generation.manifest.gui
    ) {
      return this.generationCutover(appId, () =>
        this.generationConsent.promote(appId, expectedConsentRevision)
      );
    }
    return this.generationConsent.promote(appId, expectedConsentRevision);
  }

  async remove(appId: string) {
    this.assertWritableAuthority();
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

  async retireDrainingGeneration(appId: string, generationId: string) {
    await this.queue.enqueue(async () => {
      const current = this.records.get(appId);
      if (!current?.generationBinding.drainingGenerationIds.includes(generationId)) return;
      await this.commitRecord({
        ...current,
        generations: current.generations.map((generation) =>
          generation.generationId === generationId
            ? { ...generation, retiredAt: Date.now() }
            : generation
        ),
        generationBinding: {
          ...current.generationBinding,
          bindingRevision: current.generationBinding.bindingRevision + 1,
          drainingGenerationIds: current.generationBinding.drainingGenerationIds.filter(
            (candidate) => candidate !== generationId
          ),
        },
      }, appId, current);
    });
    await this.recovery.collectArtifacts();
  }

  private artifactRoots() {
    const roots = [...this.retainedArtifactRoots.keys()].map((key) => {
      const separator = key.indexOf("/");
      return { appId: key.slice(0, separator), generationId: key.slice(separator + 1) };
    });
    for (const provider of this.artifactRootProviders) roots.push(...provider());
    return roots;
  }

  async closeAndFlush() {
    this.queue.close();
    await this.queue.flush();
  }

  async commitRecord(
    next: AppRecord,
    appId: string,
    previous: AppRecord | undefined
  ) {
    const canonical = appRecordSchema.parse(next);
    assertResidenceFenceStable(previous, canonical);
    this.assertDerivedPaths([canonical]);
    this.records.set(appId, structuredClone(canonical));
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

  /** 落盘与广播共用的排序视图：两者都只读不改，克隆留给公开的 `list()`。 */
  private snapshot() {
    return [...this.records.values()].sort(
      (left, right) => left.addedAt - right.addedAt
    );
  }

  private async persist() {
    this.assertWritableAuthority();
    const apps = this.snapshot();
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

  private assertWritableAuthority() {
    if (this.authority !== "degraded-corrupt") return;
    throw Object.assign(new Error("AppStore authority 已降级，拒绝任何 App 写入"), {
      code: "APP_STORE_AUTHORITY_DEGRADED",
    });
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

function assertResidenceFenceStable(
  previous: AppRecord | undefined,
  next: AppRecord
) {
  if (!previous?.activeUseSwitch) return;
  const bindingChanged =
    previous.generationBinding.bindingRevision !==
      next.generationBinding.bindingRevision ||
    (previous.generationBinding.active?.generationId ?? null) !==
      (next.generationBinding.active?.generationId ?? null);
  if (
    previous.state !== next.state ||
    previous.lifecycleRevision !== next.lifecycleRevision ||
    bindingChanged
  ) {
    throw Object.assign(new Error("APP_USE_RESIDENCE_MUTATION_BUSY"), {
      status: 409,
    });
  }
}
