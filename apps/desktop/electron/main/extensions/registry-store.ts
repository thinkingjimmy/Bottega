/**
 * [INPUT]: Depends on Node crypto/fs/path, zod, manifest adapter with shared Extension identities
 * [OUTPUT]: Provides ExtensionRegistryStore: immutable generation/authoritative inventory, empty v2→v3 security upgrades, three-axis status, reference fence, unloaded shutters and changes subscription
 * [POS]: The durable three-axis letter writer of extensions; Only uploads empty old files of unauthorized facts, App consent remains in integration, physical deletion must prove owner ref to zero
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type {
  ExtensionAdmissionState,
  ExtensionAdministrativeState,
  ExtensionComponentRecord,
  ExtensionEnableState,
  ExtensionInventorySnapshot,
  ExtensionPackageGenerationRef,
  PackageGenerationDataBinding,
  PackageGenerationRecord,
  Sha256Digest,
} from "../../../shared/extensions-ipc";
import type { ExtensionPackageAdmission } from "./manifest-adapter";

const SCHEMA_VERSION = 3;
const SHA_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REF_OWNER_PATTERN = /^[A-Za-z0-9:._/-]{1,500}$/;

const digestSchema = z
  .string()
  .regex(SHA_PATTERN)
  .transform((value) => value as Sha256Digest);
const generationRefSchema = z
  .object({ packageGenerationId: z.string().min(1), recordDigest: digestSchema })
  .strict();
const generationSchema = z
  .object({
    packageGenerationId: z.string().min(1),
    installIdentity: z.string().min(1),
    contentDigest: digestSchema,
    provenanceDigest: digestSchema,
    admissionEvidence: z
      .object({
        adapterId: z.string().min(1),
        schemaDigest: digestSchema,
        validatorFixtureDigest: digestSchema,
        admissionDigest: digestSchema,
      })
      .strict(),
    displayName: z.string().min(1).optional(),
    declaredCapabilityDigest: digestSchema,
    dataBinding: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }).strict(),
      z
        .object({ kind: z.literal("stdio"), pluginDataEpochId: z.string().min(1) })
        .strict(),
    ]),
    recordDigest: digestSchema,
  })
  .strict();
const componentSchema = z
  .object({
    componentIdentity: z.string().min(1),
    packageGenerationRef: generationRefSchema,
    componentId: z.string().min(1),
    kind: z.enum(["skill", "mcp-server"]),
    transport: z.enum([
      "manual-snapshot",
      "fixed-workspace",
      "stdio",
      "streamable-http",
      "sse",
    ]),
    declarationDigest: digestSchema,
    declaredConfigDigest: digestSchema,
    serverId: z.string().min(1).optional(),
  })
  .strict();
const sourceSchema = z
  .object({
    normalizedUrl: z.string().min(1),
    requestedRef: z.string(),
    resolvedCommit: z.string().min(1),
    subdirectory: z.string(),
    treeDigest: digestSchema,
    fetchedAt: z.number().int().nonnegative(),
  })
  .strict();
/* 来源是逐代事实，不是包级可变字段：旧代必须继续说出它自己的 commit，
   否则「更新后回看上一代」会读到新代的来源，那是最坏的一种不可寻址。 */
const generationSourceSchema = z
  .object({ packageGenerationId: z.string().min(1), source: sourceSchema })
  .strict();
const packageSchema = z
  .object({
    installIdentity: z.string().min(1),
    generationSources: z.array(generationSourceSchema),
    activeGenerationRef: generationRefSchema.nullable(),
    generations: z.array(generationSchema),
    components: z.array(componentSchema),
    admission: z.enum(["valid", "misconfigured"]),
    administrativeState: z
      .enum(["active", "disable-pending", "denied"])
      .default("active"),
    globalCatalogEnabled: z.boolean().default(false),
    /* renderer 兼容投影；真实判定只读上面两轴。 */
    enabled: z.enum(["enabled", "disable-pending", "disabled"]),
    enabledComponentIdentities: z.array(z.string().min(1)),
    removalPendingGenerationIds: z.array(z.string().min(1)),
  })
  .strict();
const refsSchema = z.record(
  z.string().min(1),
  z.array(z.string().regex(REF_OWNER_PATTERN)).max(100_000)
);
const storeSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    packages: z.array(packageSchema),
    refs: refsSchema,
  })
  .strict();
const emptyV2StoreSchema = z
  .object({
    schemaVersion: z.literal(2),
    revision: z.number().int().nonnegative(),
    packages: z.array(z.never()).length(0),
    refs: refsSchema.refine((value) => Object.keys(value).length === 0),
  })
  .strict();

type StoreFile = z.infer<typeof storeSchema>;
type StoredPackage = StoreFile["packages"][number];

export type ExtensionSourceProvenance = z.infer<typeof sourceSchema>;

export type ExtensionGenerationProjection = Readonly<{
  installIdentity: string;
  admission: ExtensionAdmissionState;
  administrativeState: ExtensionAdministrativeState;
  globalCatalogEnabled: boolean;
  packageEnabled: ExtensionEnableState;
  active: boolean;
  removalPending: boolean;
  enabledComponentIdentities: readonly string[];
  generation: PackageGenerationRecord;
  source: ExtensionSourceProvenance;
  components: readonly ExtensionComponentRecord[];
}>;

export type SealExtensionGenerationInput = Readonly<{
  /** 由 lifecycle ledger 预分配：重放按同一个 id 幂等，绝不生出第二代 */
  packageGenerationId: string;
  installIdentity: string;
  componentNamespace: string;
  contentDigest: Sha256Digest;
  source: ExtensionSourceProvenance;
  admission: ExtensionPackageAdmission;
  schemaDigest?: Sha256Digest;
  validatorFixtureDigest: Sha256Digest;
  displayName?: string;
  expectedActiveGenerationRef?: ExtensionPackageGenerationRef | null;
  /** seal 前就已闭合的数据绑定；含 stdio 的代只能是 stdio 分支 */
  dataBinding: PackageGenerationDataBinding;
}>;

export class ExtensionRegistryStore {
  readonly root: string;
  readonly dataRoot: string;
  readonly filePath: string;
  private state: StoreFile = emptyStore();
  private serial: Promise<void> = Promise.resolve();
  private readonly inventoryListeners = new Set<
    (snapshot: ExtensionInventorySnapshot) => void | Promise<void>
  >();

  constructor(userData: string) {
    this.root = join(userData, "agent-extensions");
    this.dataRoot = join(this.root, "data");
    this.filePath = join(this.root, "registry.json");
  }

  async initialize() {
    await mkdir(this.dataRoot, { recursive: true, mode: 0o700 });
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("Agent Extension Registry 无效，已 fail closed", { cause });
      }
      await this.persist();
      return;
    }
    try {
      const current = storeSchema.safeParse(raw);
      if (current.success) {
        this.state = current.data;
        return;
      }
      /* 空账本没有 enabled、授权或引用事实，无需猜测即可升格。非空旧档仍
         保持原字节 fail closed，不能把一次启动修复变成权限迁移器。 */
      const emptyV2 = emptyV2StoreSchema.safeParse(raw);
      if (!emptyV2.success) throw current.error;
      this.state = { ...emptyStore(), revision: emptyV2.data.revision };
      await this.persist();
    } catch (cause) {
      throw new Error("Agent Extension Registry 无效，已 fail closed", { cause });
    }
  }

  snapshot(): ExtensionInventorySnapshot {
    const packages = this.state.packages.map((item) => ({
      installIdentity: item.installIdentity,
      source: structuredClone(this.activeSource(item)),
      activeGenerationRef: item.activeGenerationRef
        ? structuredClone(item.activeGenerationRef)
        : null,
      generations: structuredClone(item.generations),
      admission: item.admission,
      administrativeState: item.administrativeState,
      globalCatalogEnabled: item.globalCatalogEnabled,
      enabled: item.enabled,
      enabledComponentIdentities: [...item.enabledComponentIdentities],
      removalPendingGenerationIds: [...item.removalPendingGenerationIds],
    }));
    const activeRefs = new Set(
      this.state.packages
        .map((item) => refKey(item.activeGenerationRef))
        .filter((value): value is string => Boolean(value))
    );
    const components = this.state.packages.flatMap((item) =>
      item.components.filter((component) =>
        activeRefs.has(refKey(component.packageGenerationRef)!)
      )
    );
    const payload = { revision: String(this.state.revision), packages, components };
    return {
      ...structuredClone(payload),
      digest: digestCanonical(payload),
    };
  }

  /** 只在 package/component inventory 真正变化时发布；ref 记账不会触发重扫。 */
  onInventoryChanged(
    listener: (snapshot: ExtensionInventorySnapshot) => void | Promise<void>
  ) {
    this.inventoryListeners.add(listener);
    return () => this.inventoryListeners.delete(listener);
  }

  sealGeneration(input: SealExtensionGenerationInput) {
    return this.mutate(async () => {
      if (!input.admission.valid) throw new Error("无效 package 不能 seal generation");
      if (input.admission.pluginRoot.length === 0) throw new Error("plugin root 缺失");
      const existing = this.state.packages.find(
        (item) => item.installIdentity === input.installIdentity
      );
      if (existing) {
        this.assertPackageMutable(existing);
        if (
          input.expectedActiveGenerationRef !== undefined &&
          refKey(existing.activeGenerationRef) !==
            refKey(input.expectedActiveGenerationRef)
        ) {
          throw conflict("扩展预检基线已变更，请重新检查来源");
        }
        const activeAdapter = existing.generations.find(
          (item) =>
            item.packageGenerationId ===
            existing.activeGenerationRef?.packageGenerationId
        )?.admissionEvidence.adapterId;
        if (activeAdapter && activeAdapter !== input.admission.adapterId) {
          throw conflict("包形态已变更：卸载后按新形态重装（授权重新开始）");
        }
      } else if (input.expectedActiveGenerationRef) {
        throw conflict("扩展预检基线已失效");
      }
      /* 更新保留 install identity，所以变的只能是 commit/tree/时间；仓库地址或
         子目录一旦不同就是另一个安装，绝不允许原地替换来源。 */
      const anchor = existing?.generationSources[0]?.source;
      if (
        anchor &&
        (anchor.normalizedUrl !== input.source.normalizedUrl ||
          anchor.subdirectory !== input.source.subdirectory)
      ) {
        throw new Error("同一 installIdentity 的来源 provenance 不可原地替换");
      }
      const { packageGenerationId, dataBinding } = input;
      /* 「含 stdio 就必须已绑定独立 epoch」是类型管不住的那半条不变量：
         epoch 的创建/恢复发生在 seal 之前，这里只拒绝对不上的 seal，
         绝不允许先 seal `none` 再原地补字段。 */
      if (input.admission.containsStdio !== (dataBinding.kind === "stdio")) {
        throw new Error("stdio package generation 必须在 seal 前绑定独立 data epoch");
      }
      if (
        this.state.packages.some((item) =>
          item.generations.some(
            (generation) => generation.packageGenerationId === packageGenerationId
          )
        )
      ) {
        throw new Error("package generation id 已存在");
      }
      const provenanceDigest = digestCanonical(input.source);
      const declarations = input.admission.components.map((component) => ({
        componentId: component.componentId,
        kind: component.kind,
        config: component.kind === "mcp-server" ? component.config : component.skillFile,
      }));
      const declaredCapabilityDigest = digestCanonical(declarations);
      const admissionDigest = digestCanonical({
        manifest: input.admission.manifest,
        diagnostics: input.admission.diagnostics,
      });
      const recordBase = {
        packageGenerationId,
        installIdentity: input.installIdentity,
        contentDigest: input.contentDigest,
        provenanceDigest,
        admissionEvidence: {
          adapterId: input.admission.adapterId,
          schemaDigest:
            input.schemaDigest ?? digestCanonical(input.admission.adapterId),
          validatorFixtureDigest: input.validatorFixtureDigest,
          admissionDigest,
        },
        ...(input.displayName ? { displayName: input.displayName } : {}),
        declaredCapabilityDigest,
        dataBinding,
      };
      const record: PackageGenerationRecord = {
        ...recordBase,
        recordDigest: digestCanonical(recordBase),
      };
      const ref = generationRef(record);
      const components = input.admission.components.map(
        (component): ExtensionComponentRecord => {
          const config =
            component.kind === "skill"
              ? { skillFile: component.skillFile }
              : component.config;
          return {
            componentIdentity: `${input.componentNamespace}/${component.componentId}`,
            packageGenerationRef: ref,
            componentId: component.componentId,
            kind: component.kind,
            transport:
              component.kind === "skill"
                ? "manual-snapshot"
                : component.config.type,
            declarationDigest: digestCanonical(component),
            declaredConfigDigest: digestCanonical(config),
            ...(component.kind === "mcp-server"
              ? { serverId: component.serverId }
              : {}),
          };
        }
      );
      const target: StoredPackage = existing ?? {
        installIdentity: input.installIdentity,
        generationSources: [],
        activeGenerationRef: null,
        generations: [],
        components: [],
        admission: "valid",
        administrativeState: "active",
        globalCatalogEnabled: false,
        enabled: "disabled",
        enabledComponentIdentities: [],
        removalPendingGenerationIds: [],
      };
      target.generations.push(record);
      target.generationSources.push({
        packageGenerationId,
        source: structuredClone(input.source),
      });
      target.components.push(...components);
      target.admission = "valid";
      if (!existing) this.state.packages.push(target);
      return structuredClone(record);
    });
  }

  /**
   * 默认指针的原子切换。新代默认回到 inert：component 逐项启用是用户的动作，
   * 不是更新的副产品。只有能力未扩大的更新才允许 `preserveEnabled` 沿用旧代
   * 的启用集合——扩权必须重新授权，这是 §「安装、启用与来源信任」的硬规则。
   */
  activateGeneration(
    ref: ExtensionPackageGenerationRef,
    options: { preserveEnabled?: boolean } = {}
  ) {
    return this.mutate(() => {
      const owner = this.requireGeneration(ref);
      this.assertPackageMutable(owner);
      const identities = new Set(
        owner.components
          .filter(
            (component) => refKey(component.packageGenerationRef) === refKey(ref)
          )
          .map((component) => component.componentIdentity)
      );
      const carried = options.preserveEnabled
        ? owner.enabledComponentIdentities.filter((item) => identities.has(item))
        : [];
      owner.activeGenerationRef = structuredClone(ref);
      owner.enabledComponentIdentities = carried.sort();
      owner.globalCatalogEnabled = carried.length > 0;
      syncLegacyEnable(owner);
    });
  }

  /** 该代自己的来源；旧代永远只说它自己那一次解析出来的 commit。 */
  generationSource(packageGenerationId: string) {
    for (const item of this.state.packages) {
      const found = item.generationSources.find(
        (entry) => entry.packageGenerationId === packageGenerationId
      );
      if (found) return structuredClone(found.source);
    }
    return null;
  }

  /**
   * 按 immutable generation ref 读它自己的组件与生命周期，不借 active
   * 指针猜。App 投影用这条窄口，才能诚实显示 retained generation。
   */
  generationProjection(
    ref: ExtensionPackageGenerationRef
  ): ExtensionGenerationProjection | null {
    const owner = this.state.packages.find((item) =>
      item.generations.some(
        (generation) =>
          generation.packageGenerationId === ref.packageGenerationId &&
          generation.recordDigest === ref.recordDigest
      )
    );
    if (!owner) return null;
    const generation = owner.generations.find(
      (item) => item.packageGenerationId === ref.packageGenerationId
    )!;
    const source = owner.generationSources.find(
      (item) => item.packageGenerationId === ref.packageGenerationId
    )?.source;
    if (!source) throw new Error("package generation 缺少来源 provenance");
    return structuredClone({
      installIdentity: owner.installIdentity,
      admission: owner.admission,
      administrativeState: owner.administrativeState,
      globalCatalogEnabled: owner.globalCatalogEnabled,
      packageEnabled: owner.enabled,
      active: refKey(owner.activeGenerationRef) === refKey(ref),
      removalPending: owner.removalPendingGenerationIds.includes(
        ref.packageGenerationId
      ),
      enabledComponentIdentities: owner.enabledComponentIdentities,
      generation,
      source,
      components: owner.components.filter(
        (component) => refKey(component.packageGenerationRef) === refKey(ref)
      ),
    });
  }

  enableComponent(componentIdentity: string) {
    return this.mutate(() => {
      const owner = this.packageForActiveComponent(componentIdentity);
      this.assertPackageMutable(owner);
      if (!owner.enabledComponentIdentities.includes(componentIdentity)) {
        owner.enabledComponentIdentities.push(componentIdentity);
        owner.enabledComponentIdentities.sort();
      }
      owner.globalCatalogEnabled = true;
      syncLegacyEnable(owner);
    });
  }

  disableComponent(componentIdentity: string) {
    return this.mutate(() => {
      const owner = this.packageForActiveComponent(componentIdentity);
      this.assertPackageMutable(owner);
      owner.enabledComponentIdentities = owner.enabledComponentIdentities.filter(
        (item) => item !== componentIdentity
      );
      owner.globalCatalogEnabled = owner.enabledComponentIdentities.length > 0;
      syncLegacyEnable(owner);
    });
  }

  /** preflight/confirm 与 seal 共用同一条 pending/CAS 判据。 */
  assertInstallCas(
    installIdentity: string,
    expected: ExtensionPackageGenerationRef | null,
    adapterId: string
  ) {
    const owner = this.state.packages.find(
      (item) => item.installIdentity === installIdentity
    );
    if (!owner) {
      if (expected) throw conflict("扩展预检基线已失效");
      return;
    }
    this.assertPackageMutable(owner);
    if (refKey(owner.activeGenerationRef) !== refKey(expected)) {
      throw conflict("扩展预检基线已变更，请重新检查来源");
    }
    const activeAdapter = owner.generations.find(
      (item) =>
        item.packageGenerationId === owner.activeGenerationRef?.packageGenerationId
    )?.admissionEvidence.adapterId;
    if (activeAdapter && activeAdapter !== adapterId) {
      throw conflict("包形态已变更：卸载后按新形态重装（授权重新开始）");
    }
  }

  beginDisable(installIdentity: string) {
    return this.mutate(() => {
      const owner = this.requirePackage(installIdentity);
      owner.administrativeState = "disable-pending";
      syncLegacyEnable(owner);
    });
  }

  completeDisable(installIdentity: string) {
    return this.mutate(() => {
      const owner = this.requirePackage(installIdentity);
      if (owner.administrativeState !== "disable-pending") {
        throw new Error("只有 disable-pending 可收敛为 disabled");
      }
      owner.administrativeState = "denied";
      owner.globalCatalogEnabled = false;
      owner.enabledComponentIdentities = [];
      syncLegacyEnable(owner);
    });
  }

  /**
   * 唯一的强引用取得点，因此也是唯一需要关的那道闸：reservation 与逐轮 plan
   * 都从这里拿 ref，卸载一旦挂上 removal-pending，两条路同时关死。
   */
  acquireGenerationRef(ref: ExtensionPackageGenerationRef, ownerId: string) {
    return this.mutate(() => {
      const generationOwner = this.requireGeneration(ref);
      if (!REF_OWNER_PATTERN.test(ownerId)) throw new Error("ref owner id 无效");
      const key = refKey(ref)!;
      const owners = new Set(this.state.refs[key] ?? []);
      /* 闸只拦**新增**引用。重放同一个 owner 是对账（崩溃恢复时 reservation
         ledger 要把自己已持有的那几条重新宣告一遍），复检存量会把一条合法的
         持久引用变成永久写入陷阱——重启一次，卸载就再也退不出来。 */
      if (
        !owners.has(ownerId) &&
        generationOwner.removalPendingGenerationIds.includes(ref.packageGenerationId)
      ) {
        throw conflict("package generation 正在卸载，不再签发新的强引用");
      }
      owners.add(ownerId);
      this.state.refs[key] = [...owners].sort();
    });
  }

  releaseGenerationRef(ref: ExtensionPackageGenerationRef, ownerId: string) {
    return this.mutate(() => {
      const key = refKey(ref)!;
      const owners = (this.state.refs[key] ?? []).filter((item) => item !== ownerId);
      if (owners.length) this.state.refs[key] = owners;
      else delete this.state.refs[key];
    });
  }

  blockers(ref: ExtensionPackageGenerationRef) {
    return [...(this.state.refs[refKey(ref)!] ?? [])];
  }

  beginGenerationRemoval(ref: ExtensionPackageGenerationRef) {
    return this.mutate(() => {
      const owner = this.requireGeneration(ref);
      if (!owner.removalPendingGenerationIds.includes(ref.packageGenerationId)) {
        owner.removalPendingGenerationIds.push(ref.packageGenerationId);
      }
    });
  }

  /**
   * 物理卸载的关闸动作：**全部**代同时挂 removal-pending。
   *
   * 只关 active 代是不够的——仍绑在更早一代上的 App 与 plan 会继续取得新的强
   * 引用，于是「等引用归零」这件事永远追不上自己。
   */
  beginPackageRemoval(installIdentity: string) {
    return this.mutate(() => {
      const owner = this.requirePackage(installIdentity);
      owner.removalPendingGenerationIds = owner.generations
        .map((item) => item.packageGenerationId)
        .sort();
      return [...owner.removalPendingGenerationIds];
    });
  }

  /** 放弃卸载：重开准入，包回到「已停用但仍安装」。 */
  cancelPackageRemoval(installIdentity: string) {
    return this.mutate(() => {
      this.requirePackage(installIdentity).removalPendingGenerationIds = [];
    });
  }

  /** 该安装的全部代 ref；卸载要按它列 blocker，只看 active 会漏掉旧代。 */
  packageGenerationRefs(installIdentity: string) {
    return (
      this.state.packages
        .find((item) => item.installIdentity === installIdentity)
        ?.generations.map(generationRef) ?? []
    );
  }

  /**
   * 整包回收。前置条件在这里一次问清：deny 已收敛、每一代都无人引用。
   * 返回被释放的内容摘要——字节回收只回收**不再被任何代引用**的那几份。
   */
  removePackage(installIdentity: string) {
    return this.mutate(() => {
      const owner = this.requirePackage(installIdentity);
      if (owner.administrativeState !== "denied") {
        throw conflict("只有已收敛为 disabled 的 package 才能物理卸载");
      }
      const blocked = owner.generations.flatMap((generation) =>
        this.blockers(generationRef(generation))
      );
      if (blocked.length) {
        throw conflict(`package generation 仍被引用：${blocked.join(", ")}`);
      }
      const released = owner.generations.map((item) => item.contentDigest);
      this.state.packages = this.state.packages.filter(
        (item) => item.installIdentity !== installIdentity
      );
      const retained = new Set(
        this.state.packages.flatMap((item) =>
          item.generations.map((generation) => generation.contentDigest)
        )
      );
      return [...new Set(released)].filter((digest) => !retained.has(digest));
    });
  }

  removeGeneration(ref: ExtensionPackageGenerationRef) {
    return this.mutate(() => {
      const owner = this.requireGeneration(ref);
      const blockers = this.blockers(ref);
      if (blockers.length) {
        throw new Error(`package generation 仍被引用：${blockers.join(", ")}`);
      }
      if (refKey(owner.activeGenerationRef) === refKey(ref)) {
        throw new Error("active package generation 不能物理删除");
      }
      owner.generations = owner.generations.filter(
        (item) => item.packageGenerationId !== ref.packageGenerationId
      );
      owner.generationSources = owner.generationSources.filter(
        (item) => item.packageGenerationId !== ref.packageGenerationId
      );
      owner.components = owner.components.filter(
        (item) => item.packageGenerationRef.packageGenerationId !== ref.packageGenerationId
      );
      owner.removalPendingGenerationIds = owner.removalPendingGenerationIds.filter(
        (id) => id !== ref.packageGenerationId
      );
    });
  }

  isComponentEnabled(componentIdentity: string) {
    const owner = this.state.packages.find((item) =>
      item.enabledComponentIdentities.includes(componentIdentity)
    );
    return owner?.administrativeState === "active" &&
      owner.globalCatalogEnabled === true;
  }

  /* 包级 source 是派生视图：以 active 代为准，尚未 activate 时取最后一代。 */
  private activeSource(item: StoredPackage) {
    const active = item.activeGenerationRef?.packageGenerationId;
    const entry =
      item.generationSources.find(
        (source) => source.packageGenerationId === active
      ) ?? item.generationSources.at(-1);
    if (!entry) throw new Error("package 缺少来源 provenance");
    return entry.source;
  }

  private requirePackage(installIdentity: string) {
    const owner = this.state.packages.find(
      (item) => item.installIdentity === installIdentity
    );
    if (!owner) throw new Error("Extension package 不存在");
    return owner;
  }

  private requireGeneration(ref: ExtensionPackageGenerationRef) {
    const owner = this.state.packages.find((item) =>
      item.generations.some(
        (generation) =>
          generation.packageGenerationId === ref.packageGenerationId &&
          generation.recordDigest === ref.recordDigest
      )
    );
    if (!owner) throw new Error("Extension package generation ref 不存在或 digest 不匹配");
    return owner;
  }

  private packageForActiveComponent(componentIdentity: string) {
    const owner = this.state.packages.find((item) =>
      item.components.some(
        (component) =>
          component.componentIdentity === componentIdentity &&
          refKey(component.packageGenerationRef) === refKey(item.activeGenerationRef)
      )
    );
    if (!owner) throw new Error("active Extension component 不存在");
    return owner;
  }

  private assertPackageMutable(owner: StoredPackage) {
    if (
      owner.administrativeState !== "active" ||
      owner.removalPendingGenerationIds.length > 0
    ) {
      throw conflict("扩展正在停用或卸载，不能修改组件或更新代");
    }
  }

  private async mutate<T>(operation: () => T | Promise<T>) {
    let resolve!: () => void;
    const wait = this.serial;
    this.serial = new Promise<void>((done) => {
      resolve = done;
    });
    await wait;
    const previous = structuredClone(this.state);
    const inventoryBefore = this.inventoryFingerprint();
    try {
      const value = await operation();
      this.state.revision += 1;
      await this.persist();
      if (inventoryBefore !== this.inventoryFingerprint()) {
        const snapshot = this.snapshot();
        for (const listener of this.inventoryListeners) {
          try {
            await listener(snapshot);
          } catch (cause) {
            console.debug("[extensions] inventory listener failed", cause);
          }
        }
      }
      return value;
    } catch (cause) {
      this.state = previous;
      throw cause;
    } finally {
      resolve();
    }
  }

  private inventoryFingerprint() {
    return canonicalJson(
      this.state.packages.map((item) => ({
        installIdentity: item.installIdentity,
        activeGenerationRef: item.activeGenerationRef,
        generations: item.generations,
        components: item.components,
        administrativeState: item.administrativeState,
        globalCatalogEnabled: item.globalCatalogEnabled,
        enabled: item.enabled,
        enabledComponentIdentities: item.enabledComponentIdentities,
        removalPendingGenerationIds: item.removalPendingGenerationIds,
      }))
    );
  }

  private async persist() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const parsed = storeSchema.parse(this.state);
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.filePath);
  }
}

function emptyStore(): StoreFile {
  return { schemaVersion: SCHEMA_VERSION, revision: 0, packages: [], refs: {} };
}

function syncLegacyEnable(owner: StoredPackage) {
  owner.enabled = owner.administrativeState === "disable-pending"
    ? "disable-pending"
    : owner.administrativeState === "denied"
      ? "disabled"
      : owner.globalCatalogEnabled
        ? "enabled"
        : "disabled";
}

function generationRef(record: PackageGenerationRecord) {
  return {
    packageGenerationId: record.packageGenerationId,
    recordDigest: record.recordDigest,
  } satisfies ExtensionPackageGenerationRef;
}

function refKey(ref: ExtensionPackageGenerationRef | null | undefined) {
  return ref ? `${ref.packageGenerationId}:${ref.recordDigest}` : null;
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}

export function digestCanonical(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}
