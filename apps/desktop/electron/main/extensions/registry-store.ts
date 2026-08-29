/**
 * [INPUT]: Depends on durable Registry persistence, strict schema/empty-ledger migration, canonical/projection kernels, and delegated install/lifecycle authorities
 * [OUTPUT]: Provides the scoped Registry facade, atomic empty-ledger upgrade, owned/visible inventory, lifecycle commands, scope invalidation, and poisoned-store boundary
 * [POS]: Durable Extension owner and transaction coordinator; only authority-free legacy state upgrades, while live incompatible facts remain fail closed
 */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ExtensionAdmissionState,
  ExtensionAdministrativeState,
  ExtensionComponentRecord,
  ExtensionEnableState,
  ExtensionInventorySnapshot,
  ExtensionPackageGenerationRef,
  ExtensionScopeMutation,
  PackageGenerationDataBinding,
  PackageGenerationRecord,
  Sha256Digest,
} from "../../../shared/extensions-ipc";
import {
  GLOBAL_PRODUCT_RESOURCE_SCOPE,
  productResourceScopeKey,
  sameProductResourceScope,
  type ProductResourceScope,
  type TurnProjectContext,
} from "../../../shared/product-resource-scope";
import type { ExtensionPackageAdmission } from "./manifest-adapter";
import {
  durableReplaceFile,
  type DurableReplaceFileFaults,
} from "../persistence/durable-json";
import {
  emptyExtensionRegistryStore,
  extensionRegistryStoreSchema,
  migrateEmptyExtensionRegistry,
  type ExtensionRegistryStoredPackage,
  type ExtensionRegistryStoreFile,
  type ExtensionSourceProvenance,
} from "./registry-schema";
import {
  canonicalJson,
  digestCanonical,
  refKey,
  registryConflict as conflict,
} from "./registry-canonical";
import { activeComponents, selectVisibleComponents } from "./registry-projection";
import { RegistryLifecycleAuthority } from "./registry-lifecycle-authority";
import { RegistryInstallAuthority } from "./registry-install-authority";
export type { ExtensionSourceProvenance } from "./registry-schema";
export { canonicalJson, digestCanonical } from "./registry-canonical";
export { selectVisibleComponents } from "./registry-projection";

type StoreFile = ExtensionRegistryStoreFile;
type StoredPackage = ExtensionRegistryStoredPackage;

export type ExtensionGenerationProjection = Readonly<{
  installIdentity: string;
  scope: ProductResourceScope;
  sourceIdentity: string;
  admission: ExtensionAdmissionState;
  administrativeState: ExtensionAdministrativeState;
  globalCatalogEnabled: boolean;
  packageEnabled: ExtensionEnableState;
  active: boolean;
  removalPending: boolean;
  enabledComponentInstanceIdentities: readonly string[];
  generation: PackageGenerationRecord;
  source: ExtensionSourceProvenance;
  components: readonly ExtensionComponentRecord[];
}>;

export type SealExtensionGenerationInput = Readonly<{
  /** 由 lifecycle ledger 预分配：重放按同一个 id 幂等，绝不生出第二代 */
  packageGenerationId: string;
  installIdentity: string;
  scope: ProductResourceScope;
  sourceIdentity: string;
  expectedScopeRevision: number;
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
  /** Durable Registry reservation acquired atomically with the install CAS. */
  installReservationOperationId?: string;
}>;

export type ReserveExtensionInstallInput = Readonly<{
  operationId: string;
  packageGenerationId: string;
  installIdentity: string;
  sourceIdentity: string;
  scope: ProductResourceScope;
  adapterId: "agent-plugins-1.0.0" | "skill-repo-1.0.0";
  expectedScopeRevision: number;
  expectedActiveGenerationRef: ExtensionPackageGenerationRef | null;
}>;

export class ExtensionRegistryStore {
  readonly root: string;
  readonly dataRoot: string;
  readonly filePath: string;
  private storedState: StoreFile = emptyExtensionRegistryStore();
  private authorityStatus: "new" | "initializing" | "ready" | "poisoned" = "new";
  private serial: Promise<void> = Promise.resolve();
  private readonly inventoryListeners = new Set<
    (event: Readonly<{ scope: ProductResourceScope; scopeRevision: number }>) =>
      void | Promise<void>
  >();
  private readonly lifecycle: RegistryLifecycleAuthority;
  private readonly installs: RegistryInstallAuthority;

  constructor(
    userData: string,
    private readonly persistenceFaults: DurableReplaceFileFaults = {}
  ) {
    this.root = join(userData, "agent-extensions");
    this.dataRoot = join(this.root, "data");
    this.filePath = join(this.root, "registry.json");
    this.lifecycle = new RegistryLifecycleAuthority({
      state: () => this.state,
      mutate: (operation, options) => this.mutate(operation, options),
      exclusive: (operation) => this.exclusive(operation),
      scopeRevision: (scope) => this.scopeRevision(scope),
    });
    this.installs = new RegistryInstallAuthority({
      state: () => this.state,
      mutate: (operation, options) => this.mutate(operation, options),
      scopeRevision: (scope) => this.scopeRevision(scope),
    });
  }

  async initialize() {
    try {
      this.authorityStatus = "initializing";
      await mkdir(this.dataRoot, { recursive: true, mode: 0o700 });
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(this.filePath, "utf8"));
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new Error("Agent Extension Registry 无效，已 fail closed", { cause });
        }
        await this.persist();
        this.authorityStatus = "ready";
        return;
      }
      try {
        const current = extensionRegistryStoreSchema.safeParse(raw);
        this.state = current.success
          ? current.data
          : migrateEmptyExtensionRegistry(raw);
        if (!current.success) await this.persist();
      } catch (cause) {
        throw new Error("Agent Extension Registry 无效，已 fail closed", { cause });
      }
      this.authorityStatus = "ready";
    } catch (cause) {
      this.authorityStatus = "poisoned";
      throw cause;
    }
  }

  private get state() {
    if (
      this.authorityStatus !== "ready" &&
      this.authorityStatus !== "initializing"
    ) {
      throw new Error("Agent Extension Registry authority 未 ready 或已 poisoned");
    }
    return this.storedState;
  }

  private set state(value: StoreFile) {
    this.storedState = value;
  }

  snapshot(): ExtensionInventorySnapshot {
    return this.ownedInventory(GLOBAL_PRODUCT_RESOURCE_SCOPE, null);
  }

  ownedInventory(
    scope: ProductResourceScope,
    projectLifecycleRevision: number | null
  ): ExtensionInventorySnapshot {
    const owned = this.state.packages.filter((item) =>
      sameProductResourceScope(item.scope, scope)
    );
    return this.projectInventory(
      owned,
      activeComponents(owned),
      scope,
      projectLifecycleRevision,
      this.scopeRevision(scope)
    );
  }

  visibleInventory(context: TurnProjectContext): ExtensionInventorySnapshot {
    const global = this.state.packages.filter((item) => item.scope.kind === "global");
    if (!context.projectId) {
      return this.projectInventory(
        global,
        selectVisibleComponents(global, []),
        GLOBAL_PRODUCT_RESOURCE_SCOPE,
        null,
        this.scopeRevision(GLOBAL_PRODUCT_RESOURCE_SCOPE)
      );
    }
    const scope = { kind: "project", projectId: context.projectId } as const;
    const project = this.state.packages.filter((item) =>
      sameProductResourceScope(item.scope, scope)
    );
    return this.projectInventory(
      [...global, ...project],
      selectVisibleComponents(global, project),
      scope,
      context.projectLifecycleRevision,
      this.scopeRevision(scope)
    );
  }

  scopeRevision(scope: ProductResourceScope) {
    return this.state.scopeRevisions[productResourceScopeKey(scope)] ?? 0;
  }

  private projectInventory(
    selectedPackages: readonly StoredPackage[],
    selectedComponents: readonly ExtensionComponentRecord[],
    scope: ProductResourceScope,
    projectLifecycleRevision: number | null,
    scopeRevision: number
  ): ExtensionInventorySnapshot {
    const packages = selectedPackages.map((item) => ({
      installIdentity: item.installIdentity,
      scope: structuredClone(item.scope),
      sourceIdentity: item.sourceIdentity,
      source: structuredClone(this.activeSource(item)),
      activeGenerationRef: item.activeGenerationRef
        ? structuredClone(item.activeGenerationRef)
        : null,
      generations: structuredClone(item.generations),
      admission: item.admission,
      administrativeState: item.administrativeState,
      globalCatalogEnabled: item.enabledComponentInstanceIdentities.length > 0,
      enabled: item.enabled,
      enabledComponentInstanceIdentities: [
        ...item.enabledComponentInstanceIdentities,
      ],
      removalPendingGenerationIds: [...item.removalPendingGenerationIds],
    }));
    const version = { scope, projectLifecycleRevision, scopeRevision };
    const globalScopeRevision = this.scopeRevision(GLOBAL_PRODUCT_RESOURCE_SCOPE);
    const payload = { version, globalScopeRevision, packages, components: selectedComponents };
    return {
      ...structuredClone(payload),
      digest: digestCanonical(payload),
      visibleInventoryVersion: digestCanonical({ version, globalScopeRevision }),
    };
  }

  /** 只在 package/component inventory 真正变化时发布；ref 记账不会触发重扫。 */
  onInventoryChanged(
    listener: (event: Readonly<{ scope: ProductResourceScope; scopeRevision: number }>) =>
      void | Promise<void>
  ) {
    this.inventoryListeners.add(listener);
    return () => this.inventoryListeners.delete(listener);
  }


  sealGeneration(input: SealExtensionGenerationInput) { return this.installs.sealGeneration(input); }
  activateGeneration(...args: Parameters<RegistryInstallAuthority["activateGeneration"]>) { return this.installs.activateGeneration(...args); }
  reserveInstall(input: ReserveExtensionInstallInput) { return this.installs.reserveInstall(input); }
  releaseInstallReservation(...args: Parameters<RegistryInstallAuthority["releaseInstallReservation"]>) { return this.installs.releaseInstallReservation(...args); }
  installReservation(...args: Parameters<RegistryInstallAuthority["installReservation"]>) { return this.installs.installReservation(...args); }
  generationSource(...args: Parameters<RegistryInstallAuthority["generationSource"]>) { return this.installs.generationSource(...args); }
  generationProjection(...args: Parameters<RegistryInstallAuthority["generationProjection"]>): ExtensionGenerationProjection | null { return this.installs.generationProjection(...args); }

  enableComponent(...args: Parameters<RegistryLifecycleAuthority["enableComponent"]>) { return this.lifecycle.enableComponent(...args); }
  disableComponent(...args: Parameters<RegistryLifecycleAuthority["disableComponent"]>) { return this.lifecycle.disableComponent(...args); }
  assertInstallCas(...args: Parameters<RegistryLifecycleAuthority["assertInstallCas"]>) { return this.lifecycle.assertInstallCas(...args); }
  assertScopeMutation(...args: Parameters<RegistryLifecycleAuthority["assertScopeMutation"]>) { return this.lifecycle.assertScopeMutation(...args); }
  runScopeMutation<T>(input: ExtensionScopeMutation, operation: () => Promise<T>) { return this.lifecycle.runScopeMutation(input, operation); }
  runScopeRevisionMutation<T>(scope: ProductResourceScope, revision: number, operation: () => Promise<T>) { return this.lifecycle.runScopeRevisionMutation(scope, revision, operation); }
  packageOwners(...args: Parameters<RegistryLifecycleAuthority["packageOwners"]>) { return this.lifecycle.packageOwners(...args); }
  packageInventory(...args: Parameters<RegistryLifecycleAuthority["packageInventory"]>) { return this.lifecycle.packageInventory(...args); }
  generationRecordById(...args: Parameters<RegistryLifecycleAuthority["generationRecordById"]>) { return this.lifecycle.generationRecordById(...args); }
  contentDigestReferenced(...args: Parameters<RegistryLifecycleAuthority["contentDigestReferenced"]>) { return this.lifecycle.contentDigestReferenced(...args); }
  referencedContentDigests() { return this.lifecycle.referencedContentDigests(); }
  removeScopeTombstone(...args: Parameters<RegistryLifecycleAuthority["removeScopeTombstone"]>) { return this.lifecycle.removeScopeTombstone(...args); }
  beginDisable(...args: Parameters<RegistryLifecycleAuthority["beginDisable"]>) { return this.lifecycle.beginDisable(...args); }
  resumeBeginDisable(...args: Parameters<RegistryLifecycleAuthority["resumeBeginDisable"]>) { return this.lifecycle.resumeBeginDisable(...args); }
  completeDisable(...args: Parameters<RegistryLifecycleAuthority["completeDisable"]>) { return this.lifecycle.completeDisable(...args); }
  acquireGenerationRef(...args: Parameters<RegistryLifecycleAuthority["acquireGenerationRef"]>) { return this.lifecycle.acquireGenerationRef(...args); }
  acquireGenerationRefs(...args: Parameters<RegistryLifecycleAuthority["acquireGenerationRefs"]>) { return this.lifecycle.acquireGenerationRefs(...args); }
  releaseGenerationRef(...args: Parameters<RegistryLifecycleAuthority["releaseGenerationRef"]>) { return this.lifecycle.releaseGenerationRef(...args); }
  releaseGenerationRefs(...args: Parameters<RegistryLifecycleAuthority["releaseGenerationRefs"]>) { return this.lifecycle.releaseGenerationRefs(...args); }
  blockers(...args: Parameters<RegistryLifecycleAuthority["blockers"]>) { return this.lifecycle.blockers(...args); }
  generationRefsHeldByOwnerPrefix(...args: Parameters<RegistryLifecycleAuthority["generationRefsHeldByOwnerPrefix"]>) { return this.lifecycle.generationRefsHeldByOwnerPrefix(...args); }
  beginGenerationRemoval(...args: Parameters<RegistryLifecycleAuthority["beginGenerationRemoval"]>) { return this.lifecycle.beginGenerationRemoval(...args); }
  beginPackageRemoval(...args: Parameters<RegistryLifecycleAuthority["beginPackageRemoval"]>) { return this.lifecycle.beginPackageRemoval(...args); }
  resumePackageRemoval(...args: Parameters<RegistryLifecycleAuthority["resumePackageRemoval"]>) { return this.lifecycle.resumePackageRemoval(...args); }
  cancelPackageRemoval(...args: Parameters<RegistryLifecycleAuthority["cancelPackageRemoval"]>) { return this.lifecycle.cancelPackageRemoval(...args); }
  resumeCancelPackageRemoval(...args: Parameters<RegistryLifecycleAuthority["resumeCancelPackageRemoval"]>) { return this.lifecycle.resumeCancelPackageRemoval(...args); }
  packageGenerationRefs(...args: Parameters<RegistryLifecycleAuthority["packageGenerationRefs"]>) { return this.lifecycle.packageGenerationRefs(...args); }
  removePackage(...args: Parameters<RegistryLifecycleAuthority["removePackage"]>) { return this.lifecycle.removePackage(...args); }
  removeGeneration(...args: Parameters<RegistryLifecycleAuthority["removeGeneration"]>) { return this.lifecycle.removeGeneration(...args); }
  isComponentEnabled(...args: Parameters<RegistryLifecycleAuthority["isComponentEnabled"]>) { return this.lifecycle.isComponentEnabled(...args); }

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

  private packageForActiveComponent(componentInstanceIdentity: string) {
    const owner = this.state.packages.find((item) =>
      item.components.some(
        (component) =>
          component.componentInstanceIdentity === componentInstanceIdentity &&
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

  private async mutate<T>(
    operation: () => T | Promise<T>,
    options: Readonly<{
      retireScopeKeys?: ReadonlySet<string>;
      installReservationOperationId?: string;
    }> = {}
  ) {
    return this.exclusive(async () => {
      const previous = structuredClone(this.state);
      const inventoryBefore = this.scopeFingerprints();
      try {
        const value = await operation();
        const inventoryAfter = this.scopeFingerprints();
        const changedScopes = new Set([
          ...inventoryBefore.keys(),
          ...inventoryAfter.keys(),
        ]);
        const invalidations: { scope: ProductResourceScope; scopeRevision: number }[] = [];
        for (const scopeKey of changedScopes) {
          if (inventoryBefore.get(scopeKey) === inventoryAfter.get(scopeKey)) continue;
          const scope = scopeFromKey(scopeKey);
          const reservation = [...previous.installReservations, ...this.state.installReservations]
            .find(
              (item) =>
                item.phase === "reserved" &&
                productResourceScopeKey(item.scope) === scopeKey
            );
          if (
            reservation &&
            reservation.operationId !== options.installReservationOperationId
          ) {
            throw conflict("Extension scope 被 install reservation 冻结");
          }
          const scopeRevision =
            (previous.scopeRevisions[scopeKey] ??
              this.state.scopeRevisions[scopeKey] ??
              0) + 1;
          if (!options.retireScopeKeys?.has(scopeKey)) {
            this.state.scopeRevisions[scopeKey] = scopeRevision;
          }
          invalidations.push({ scope, scopeRevision });
        }
        this.state.revision += 1;
        try {
          await this.persist();
        } catch (cause) {
          this.state = previous;
          this.authorityStatus = "poisoned";
          throw cause;
        }
        for (const event of invalidations) {
          for (const listener of this.inventoryListeners) {
            try {
              await listener(event);
            } catch (cause) {
              console.debug("[extensions] inventory listener failed", cause);
            }
          }
        }
        return value;
      } catch (cause) {
        if (this.authorityStatus !== "poisoned") this.state = previous;
        throw cause;
      }
    });
  }

  private async exclusive<T>(operation: () => Promise<T>) {
    let resolve!: () => void;
    const wait = this.serial;
    this.serial = new Promise<void>((done) => {
      resolve = done;
    });
    await wait;
    try {
      return await operation();
    } finally {
      resolve();
    }
  }

  private assertScopeRevision(
    scope: ProductResourceScope,
    expectedScopeRevision: number
  ) {
    if (this.scopeRevision(scope) !== expectedScopeRevision) {
      throw conflict("Extension scope revision 已变更");
    }
  }

  private activeInstallReservation(scope: ProductResourceScope) {
    return this.state.installReservations.find(
      (item) =>
        item.phase === "reserved" &&
        sameProductResourceScope(item.scope, scope)
    );
  }

  private lifecycleReceipt(operationId: string) {
    return this.state.lifecycleReceipts.find(
      (item) => item.operationId === operationId
    );
  }

  private requireLifecycleReceipt<K extends "disable" | "uninstall">(
    operationId: string,
    kind: K
  ): Extract<StoreFile["lifecycleReceipts"][number], { kind: K }> {
    const receipt = this.lifecycleReceipt(operationId);
    if (!receipt || receipt.kind !== kind) {
      throw conflict("Extension lifecycle Registry receipt 不存在或类型不匹配");
    }
    return receipt as Extract<
      StoreFile["lifecycleReceipts"][number],
      { kind: K }
    >;
  }

  private assertLifecycleOwnerAvailable(installIdentity: string) {
    const active = this.state.lifecycleReceipts.find(
      (item) =>
        item.installIdentity === installIdentity && item.phase === "pending"
    );
    if (active) {
      throw conflict("Extension owner 已有 active lifecycle operation");
    }
  }

  private requireInstallReservation(operationId: string) {
    const reservation = this.state.installReservations.find(
      (item) => item.operationId === operationId
    );
    if (!reservation) throw conflict("Extension install reservation 不存在");
    return reservation;
  }

  private assertInstallReservation(input: {
    operationId: string;
    packageGenerationId: string;
    installIdentity: string;
    sourceIdentity: string;
    scope: ProductResourceScope;
    adapterId: string;
    expectedScopeRevision: number;
    expectedActiveGenerationRef: ExtensionPackageGenerationRef | null;
  }) {
    const reservation = this.requireInstallReservation(input.operationId);
    if (
      reservation.packageGenerationId !== input.packageGenerationId ||
      reservation.installIdentity !== input.installIdentity ||
      reservation.sourceIdentity !== input.sourceIdentity ||
      reservation.adapterId !== input.adapterId ||
      reservation.expectedScopeRevision !== input.expectedScopeRevision ||
      !sameProductResourceScope(reservation.scope, input.scope) ||
      refKey(reservation.expectedActiveGenerationRef) !==
        refKey(input.expectedActiveGenerationRef)
    ) {
      throw conflict("Extension install reservation identity 已漂移");
    }
    return reservation;
  }

  private scopeFingerprints() {
    const keys = new Set([
      "global",
      ...Object.keys(this.state.scopeRevisions),
      ...this.state.packages.map((item) => productResourceScopeKey(item.scope)),
    ]);
    return new Map([...keys].map((scopeKey) => [
      scopeKey,
      canonicalJson(this.state.packages
        .filter((item) => productResourceScopeKey(item.scope) === scopeKey)
        .map((item) => ({
        installIdentity: item.installIdentity,
        scope: item.scope,
        sourceIdentity: item.sourceIdentity,
        activeGenerationRef: item.activeGenerationRef,
        generations: item.generations,
        components: item.components,
        administrativeState: item.administrativeState,
        enabled: item.enabled,
        enabledComponentInstanceIdentities:
          item.enabledComponentInstanceIdentities,
        removalPendingGenerationIds: item.removalPendingGenerationIds,
      }))),
    ]));
  }

  private async persist() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const parsed = extensionRegistryStoreSchema.parse(this.state);
    await durableReplaceFile(
      this.filePath,
      `${JSON.stringify(parsed, null, 2)}\n`,
      0o600,
      this.persistenceFaults
    );
  }
}


function scopeFromKey(scopeKey: string): ProductResourceScope {
  if (scopeKey === "global") return GLOBAL_PRODUCT_RESOURCE_SCOPE;
  if (!scopeKey.startsWith("project:")) throw new Error("Extension scope key 无效");
  return { kind: "project", projectId: scopeKey.slice("project:".length) };
}
