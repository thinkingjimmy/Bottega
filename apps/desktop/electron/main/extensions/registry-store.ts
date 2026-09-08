/**
 * [INPUT]: Depends on durable Registry persistence, the strict schema-v7 contract, canonical/projection kernels, and delegated install/lifecycle authorities
 * [OUTPUT]: Provides the scoped Registry facade exposing its public lifecycle/installs authorities, owned/visible inventory, scope invalidation, and poisoned-store boundary
 * [POS]: Durable Extension owner and transaction coordinator; any ledger that is not exactly schema-v7 fails closed without rewriting bytes
 */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ExtensionComponentRecord,
  ExtensionInventorySnapshot,
  ExtensionPackageGenerationRef,
} from "../../../shared/extensions-ipc";
import {
  GLOBAL_PRODUCT_RESOURCE_SCOPE,
  productResourceScopeKey,
  sameProductResourceScope,
  type ProductResourceScope,
  type TurnProjectContext,
} from "../../../shared/product-resource-scope";
import {
  durableReplaceFile,
  type DurableReplaceFileFaults,
} from "../persistence/durable-json";
import {
  emptyExtensionRegistryStore,
  extensionRegistryStoreSchema,
  type ExtensionRegistryStoredPackage,
  type ExtensionRegistryStoreFile,
} from "./registry-schema";
import {
  canonicalJson,
  digestCanonical,
  packageEnableState,
  refKey,
  registryConflict as conflict,
} from "./registry-canonical";
import { activeComponents, selectVisibleComponents } from "./registry-projection";
import {
  RegistryLifecycleAuthority,
  type RegistryTransactionHost,
} from "./registry-lifecycle-authority";
import { RegistryInstallAuthority } from "./registry-install-authority";

type StoreFile = ExtensionRegistryStoreFile;
type StoredPackage = ExtensionRegistryStoredPackage;

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
  readonly lifecycle: RegistryLifecycleAuthority;
  readonly installs: RegistryInstallAuthority;

  constructor(
    userData: string,
    private readonly persistenceFaults: DurableReplaceFileFaults = {}
  ) {
    this.root = join(userData, "agent-extensions");
    this.dataRoot = join(this.root, "data");
    this.filePath = join(this.root, "registry.json");
    const host: RegistryTransactionHost = {
      state: () => this.state,
      mutate: (operation, options) => this.mutate(operation, options),
      exclusive: (operation) => this.exclusive(operation),
      scopeRevision: (scope) => this.scopeRevision(scope),
    };
    this.lifecycle = new RegistryLifecycleAuthority(host);
    this.installs = new RegistryInstallAuthority(host);
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
      const current = extensionRegistryStoreSchema.safeParse(raw);
      if (!current.success) {
        throw new Error("Agent Extension Registry 无效，已 fail closed", {
          cause: current.error,
        });
      }
      this.state = current.data;
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
      enabled: packageEnableState(item),
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
              console.warn("[extensions] inventory listener failed", cause);
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
