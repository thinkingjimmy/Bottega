/**
 * [INPUT]: Depends on Registry mutation transactions, canonical identities, admitted package manifests, and strict stored state
 * [OUTPUT]: Provides install reservation CAS, generation seal/activate, generation source, and exact generation projection
 * [POS]: Registry install/update authority; registry-store.ts persists transactions and exposes this narrow facade
 */

import type {
  ExtensionAdmissionState,
  ExtensionAdministrativeState,
  ExtensionComponentRecord,
  ExtensionEnableState,
  ExtensionPackageGenerationRef,
  PackageGenerationDataBinding,
  PackageGenerationRecord,
  Sha256Digest,
} from "../../../shared/extensions-ipc";
import { sameProductResourceScope, type ProductResourceScope } from "../../../shared/product-resource-scope";
import type { ExtensionPackageAdmission } from "./manifest-adapter";
import type {
  ExtensionRegistryStoredPackage,
  ExtensionRegistryStoreFile,
  ExtensionSourceProvenance,
} from "./registry-schema";
import {
  digestCanonical,
  exactGenerationRef,
  generationRef,
  refKey,
  registryConflict as conflict,
  syncLegacyEnable,
} from "./registry-canonical";

type StoreFile = ExtensionRegistryStoreFile;
type StoredPackage = ExtensionRegistryStoredPackage;
type MutateOptions = Readonly<{ installReservationOperationId?: string }>;

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
  dataBinding: PackageGenerationDataBinding;
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

export type RegistryInstallHost = Readonly<{
  state(): StoreFile;
  mutate<T>(operation: () => T | Promise<T>, options?: MutateOptions): Promise<T>;
  scopeRevision(scope: ProductResourceScope): number;
}>;

export class RegistryInstallAuthority {
  constructor(private readonly host: RegistryInstallHost) {}
  private get state() { return this.host.state(); }
  private mutate<T>(operation: () => T | Promise<T>, options: MutateOptions = {}) {
    return this.host.mutate(operation, options);
  }
  private scopeRevision(scope: ProductResourceScope) { return this.host.scopeRevision(scope); }

  sealGeneration(input: SealExtensionGenerationInput) {
    return this.mutate(async () => {
      if (!input.admission.valid) throw new Error("无效 package 不能 seal generation");
      if (input.admission.pluginRoot.length === 0) throw new Error("plugin root 缺失");
      const existing = this.state.packages.find(
        (item) => item.installIdentity === input.installIdentity
      );
      if (input.installReservationOperationId) {
        this.assertInstallReservation({
          operationId: input.installReservationOperationId,
          packageGenerationId: input.packageGenerationId,
          installIdentity: input.installIdentity,
          sourceIdentity: input.sourceIdentity,
          scope: input.scope,
          adapterId: input.admission.adapterId,
          expectedScopeRevision: input.expectedScopeRevision,
          expectedActiveGenerationRef: input.expectedActiveGenerationRef ?? null,
        });
      } else if (this.scopeRevision(input.scope) !== input.expectedScopeRevision) {
        throw conflict("Extension scope revision 已变更");
      }
      if (existing) {
        if (!sameProductResourceScope(existing.scope, input.scope)) {
          throw conflict("Extension package 不属于目标 scope");
        }
        if (existing.sourceIdentity !== input.sourceIdentity) {
          throw conflict("Extension source identity 已变更");
        }
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
      const record: StoredPackage["generations"][number] = {
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
          const declaredComponentIdentity =
            `${input.componentNamespace}/${component.componentId}`;
          return {
            declaredComponentIdentity,
            componentInstanceIdentity: digestCanonical([
              input.installIdentity,
              declaredComponentIdentity,
            ]),
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
        scope: structuredClone(input.scope),
        sourceIdentity: input.sourceIdentity,
        generationSources: [],
        activeGenerationRef: null,
        generations: [],
        components: [],
        admission: "valid",
        administrativeState: "active",
        enabled: "disabled",
        enabledComponentInstanceIdentities: [],
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
    }, { installReservationOperationId: input.installReservationOperationId });
  }

  /**
   * 默认指针的原子切换。新代默认回到 inert：component 逐项启用是用户的动作，
   * 不是更新的副产品。只有能力未扩大的更新才允许 `preserveEnabled` 沿用旧代
   * 的启用集合——扩权必须重新授权，这是 §「安装、启用与来源信任」的硬规则。
   */
  activateGeneration(
    ref: ExtensionPackageGenerationRef,
    options: {
      preserveEnabled?: boolean;
      enableAll?: boolean;
      installReservationOperationId?: string;
    } = {}
  ) {
    return this.mutate(() => {
      const owner = this.requireGeneration(ref);
      const reservation = options.installReservationOperationId
        ? this.requireInstallReservation(options.installReservationOperationId)
        : null;
      if (reservation) {
        if (
          reservation.installIdentity !== owner.installIdentity ||
          reservation.packageGenerationId !== ref.packageGenerationId ||
          !sameProductResourceScope(reservation.scope, owner.scope)
        ) {
          throw conflict("install reservation 与 generation owner 不一致");
        }
        if (reservation.phase === "activated") {
          if (refKey(reservation.activatedGenerationRef) !== refKey(ref)) {
            throw conflict("install reservation 已被另一代消费");
          }
          return;
        }
      }
      this.assertPackageMutable(owner);
      const identities = new Set(
        owner.components
          .filter(
            (component) => refKey(component.packageGenerationRef) === refKey(ref)
          )
          .map((component) => component.componentInstanceIdentity)
      );
      if (options.preserveEnabled && options.enableAll) {
        throw new Error("preserveEnabled 与 enableAll 不能同时使用");
      }
      const carried = options.enableAll
        ? [...identities]
        : options.preserveEnabled
          ? owner.enabledComponentInstanceIdentities.filter((item) => identities.has(item))
          : [];
      owner.activeGenerationRef = exactGenerationRef(ref);
      owner.enabledComponentInstanceIdentities = carried.sort();
      syncLegacyEnable(owner);
      if (reservation) {
        reservation.phase = "activated";
        reservation.activatedGenerationRef = exactGenerationRef(ref);
      }
    }, { installReservationOperationId: options.installReservationOperationId });
  }

  /** Atomically validates the renderer CAS baseline and publishes a scope fence. */
  reserveInstall(input: ReserveExtensionInstallInput) {
    return this.mutate(() => {
      const existing = this.state.installReservations.find(
        (item) => item.operationId === input.operationId
      );
      if (existing) {
        this.assertInstallReservation(input);
        return structuredClone(existing);
      }
      if (this.activeInstallReservation(input.scope)) {
        throw conflict("Extension scope 已有 install reservation");
      }
      this.assertInstallCas(
        input.installIdentity,
        input.expectedActiveGenerationRef,
        input.adapterId,
        input.scope,
        input.expectedScopeRevision
      );
      this.state.installReservations.push({
        operationId: input.operationId,
        packageGenerationId: input.packageGenerationId,
        installIdentity: input.installIdentity,
        sourceIdentity: input.sourceIdentity,
        scope: structuredClone(input.scope),
        adapterId: input.adapterId,
        expectedScopeRevision: input.expectedScopeRevision,
        expectedActiveGenerationRef: structuredClone(
          input.expectedActiveGenerationRef
        ),
        activatedGenerationRef: null,
        phase: "reserved",
      });
      return structuredClone(this.requireInstallReservation(input.operationId));
    });
  }

  releaseInstallReservation(operationId: string) {
    return this.mutate(() => {
      this.state.installReservations = this.state.installReservations.filter(
        (item) => item.operationId !== operationId
      );
    });
  }

  installReservation(operationId: string) {
    const found = this.state.installReservations.find(
      (item) => item.operationId === operationId
    );
    return found ? structuredClone(found) : null;
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
      scope: owner.scope,
      sourceIdentity: owner.sourceIdentity,
      admission: owner.admission,
      administrativeState: owner.administrativeState,
      globalCatalogEnabled: owner.enabledComponentInstanceIdentities.length > 0,
      packageEnabled: owner.enabled,
      active: refKey(owner.activeGenerationRef) === refKey(ref),
      removalPending: owner.removalPendingGenerationIds.includes(
        ref.packageGenerationId
      ),
      enabledComponentInstanceIdentities:
        owner.enabledComponentInstanceIdentities,
      generation,
      source,
      components: owner.components.filter(
        (component) => refKey(component.packageGenerationRef) === refKey(ref)
      ),
    });
  }

  private activeSource(item: StoredPackage) {
    const active = item.activeGenerationRef?.packageGenerationId;
    const entry = item.generationSources.find((source) => source.packageGenerationId === active) ?? item.generationSources.at(-1);
    if (!entry) throw new Error("package 缺少来源 provenance");
    return entry.source;
  }

  private requirePackage(installIdentity: string) {
    const owner = this.state.packages.find((item) => item.installIdentity === installIdentity);
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

  private assertPackageMutable(owner: StoredPackage) {
    if (owner.administrativeState !== "active" || owner.removalPendingGenerationIds.length > 0) {
      throw conflict("扩展正在停用或卸载，不能修改组件或更新代");
    }
  }

  private assertScopeRevision(scope: ProductResourceScope, expected: number) {
    if (this.scopeRevision(scope) !== expected) throw conflict("Extension scope revision 已变更");
  }

  private activeInstallReservation(scope: ProductResourceScope) {
    return this.state.installReservations.find(
      (item) => item.phase === "reserved" && sameProductResourceScope(item.scope, scope)
    );
  }

  private assertInstallCas(
    installIdentity: string,
    expected: ExtensionPackageGenerationRef | null,
    adapterId: string,
    scope: ProductResourceScope,
    expectedScopeRevision: number
  ) {
    this.assertScopeRevision(scope, expectedScopeRevision);
    const owner = this.state.packages.find((item) => item.installIdentity === installIdentity);
    if (!owner) {
      if (expected) throw conflict("扩展预检基线已变更，请重新检查来源");
      return;
    }
    if (!sameProductResourceScope(owner.scope, scope)) {
      throw conflict("Extension package 不属于目标 scope");
    }
    this.assertPackageMutable(owner);
    if (refKey(owner.activeGenerationRef) !== refKey(expected)) {
      throw conflict("扩展预检基线已变更，请重新检查来源");
    }
    const activeAdapter = owner.generations.find(
      (item) => item.packageGenerationId === owner.activeGenerationRef?.packageGenerationId
    )?.admissionEvidence.adapterId;
    if (activeAdapter && activeAdapter !== adapterId) {
      throw conflict("包形态已变更：卸载后按新形态重装（授权重新开始）");
    }
  }

  private requireInstallReservation(operationId: string) {
    const reservation = this.state.installReservations.find((item) => item.operationId === operationId);
    if (!reservation) throw conflict("Extension install reservation 不存在");
    return reservation;
  }

  private assertInstallReservation(input: ReserveExtensionInstallInput) {
    const reservation = this.requireInstallReservation(input.operationId);
    if (
      reservation.packageGenerationId !== input.packageGenerationId ||
      reservation.installIdentity !== input.installIdentity ||
      reservation.sourceIdentity !== input.sourceIdentity ||
      reservation.adapterId !== input.adapterId ||
      reservation.expectedScopeRevision !== input.expectedScopeRevision ||
      !sameProductResourceScope(reservation.scope, input.scope) ||
      refKey(reservation.expectedActiveGenerationRef) !== refKey(input.expectedActiveGenerationRef)
    ) throw conflict("Extension install reservation identity 已漂移");
    return reservation;
  }
}
