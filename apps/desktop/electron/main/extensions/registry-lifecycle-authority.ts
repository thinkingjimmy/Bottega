/**
 * [INPUT]: Depends on the Registry mutation transaction, strict stored state, canonical generation keys, and Product scope identity
 * [OUTPUT]: Provides component enablement, scope CAS, tombstone retirement, exact refs, and operation-bound disable/uninstall state transitions
 * [POS]: Registry lifecycle authority; registry-store.ts owns persistence and delegates lifecycle state transitions here
 */

import type { ExtensionPackageGenerationRef, ExtensionScopeMutation, Sha256Digest } from "../../../shared/extensions-ipc";
import { productResourceScopeKey, sameProductResourceScope, type ProductResourceScope } from "../../../shared/product-resource-scope";
import type { ExtensionRegistryStoredPackage, ExtensionRegistryStoreFile } from "./registry-schema";
import {
  generationRef,
  refKey,
  registryConflict as conflict,
  syncLegacyEnable,
} from "./registry-canonical";

const REF_OWNER_PATTERN = /^[A-Za-z0-9:._/-]{1,500}$/;
type StoreFile = ExtensionRegistryStoreFile;
type StoredPackage = ExtensionRegistryStoredPackage;
type MutateOptions = Readonly<{
  retireScopeKeys?: ReadonlySet<string>;
  installReservationOperationId?: string;
}>;
export type ExtensionScopeMutationOwner = Readonly<{
  installIdentity: string;
  scope: ProductResourceScope;
  sourceIdentity: string;
}>;
export type RegistryLifecycleHost = Readonly<{
  state(): StoreFile;
  mutate<T>(operation: () => T | Promise<T>, options?: MutateOptions): Promise<T>;
  exclusive<T>(operation: () => Promise<T>): Promise<T>;
  scopeRevision(scope: ProductResourceScope): number;
}>;

export class RegistryLifecycleAuthority {
  constructor(private readonly host: RegistryLifecycleHost) {}
  private get state() { return this.host.state(); }
  private mutate<T>(operation: () => T | Promise<T>, options: MutateOptions = {}) {
    return this.host.mutate(operation, options);
  }
  private exclusive<T>(operation: () => Promise<T>) { return this.host.exclusive(operation); }
  private scopeRevision(scope: ProductResourceScope) { return this.host.scopeRevision(scope); }

  enableComponent(componentInstanceIdentity: string) {
    return this.mutate(() => {
      const owner = this.packageForActiveComponent(componentInstanceIdentity);
      this.assertPackageMutable(owner);
      if (!owner.enabledComponentInstanceIdentities.includes(componentInstanceIdentity)) {
        owner.enabledComponentInstanceIdentities.push(componentInstanceIdentity);
        owner.enabledComponentInstanceIdentities.sort();
      }
      syncLegacyEnable(owner);
    });
  }

  disableComponent(componentInstanceIdentity: string) {
    return this.mutate(() => {
      const owner = this.packageForActiveComponent(componentInstanceIdentity);
      this.assertPackageMutable(owner);
      owner.enabledComponentInstanceIdentities = owner.enabledComponentInstanceIdentities.filter(
        (item) => item !== componentInstanceIdentity
      );
      syncLegacyEnable(owner);
    });
  }

  /** preflight/confirm 与 seal 共用同一条 pending/CAS 判据。 */
  assertInstallCas(
    installIdentity: string,
    expected: ExtensionPackageGenerationRef | null,
    adapterId: string,
    expectedScope: ProductResourceScope,
    expectedScopeRevision: number
  ) {
    if (this.scopeRevision(expectedScope) !== expectedScopeRevision) {
      throw conflict("Extension scope revision 已变更");
    }
    const owner = this.state.packages.find(
      (item) => item.installIdentity === installIdentity
    );
    if (!owner) {
      if (expected) throw conflict("扩展预检基线已失效");
      return;
    }
    if (!sameProductResourceScope(owner.scope, expectedScope)) {
      throw conflict("Extension package 不属于目标 scope");
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

  assertScopeMutation(input: {
    installIdentity: string;
    expectedScope: ProductResourceScope;
    expectedScopeRevision: number;
  }) {
    return structuredClone(this.scopeMutationOwner(input));
  }

  runScopeMutation<T>(
    input: ExtensionScopeMutation,
    operation: () => Promise<T>
  ) {
    return this.exclusive(async () => {
      this.scopeMutationOwner(input);
      const value = await operation();
      this.scopeMutationOwner(input);
      return value;
    });
  }

  runScopeRevisionMutation<T>(
    scope: ProductResourceScope,
    expectedScopeRevision: number,
    operation: () => Promise<T>
  ) {
    return this.exclusive(async () => {
      this.assertScopeRevision(scope, expectedScopeRevision);
      const value = await operation();
      this.assertScopeRevision(scope, expectedScopeRevision);
      return value;
    });
  }

  private scopeMutationOwner(input: {
    installIdentity: string;
    expectedScope: ProductResourceScope;
    expectedScopeRevision: number;
  }) {
    if (this.scopeRevision(input.expectedScope) !== input.expectedScopeRevision) {
      throw conflict("Extension scope revision 已变更");
    }
    const owner = this.requirePackage(input.installIdentity);
    if (!sameProductResourceScope(owner.scope, input.expectedScope)) {
      throw conflict("Extension package 不属于目标 scope");
    }
    return {
      installIdentity: owner.installIdentity,
      scope: owner.scope,
      sourceIdentity: owner.sourceIdentity,
    };
  }

  packageOwners(scope: ProductResourceScope) {
    return this.state.packages
      .filter((item) => sameProductResourceScope(item.scope, scope))
      .map((item) => ({
        installIdentity: item.installIdentity,
        scope: structuredClone(item.scope),
        sourceIdentity: item.sourceIdentity,
      }));
  }

  packageInventory(installIdentity: string) {
    const owner = this.state.packages.find(
      (item) => item.installIdentity === installIdentity
    );
    return owner ? structuredClone(owner) : null;
  }

  generationRecordById(packageGenerationId: string) {
    for (const owner of this.state.packages) {
      const generation = owner.generations.find(
        (item) => item.packageGenerationId === packageGenerationId
      );
      if (generation) return structuredClone(generation);
    }
    return null;
  }

  contentDigestReferenced(contentDigest: Sha256Digest) {
    return this.state.packages.some((item) =>
      item.generations.some((generation) => generation.contentDigest === contentDigest)
    );
  }

  referencedContentDigests() {
    return [
      ...new Set(
        this.state.packages.flatMap((item) =>
          item.generations.map((generation) => generation.contentDigest)
        )
      ),
    ];
  }

  removeScopeTombstone(scope: ProductResourceScope) {
    const scopeKey = productResourceScopeKey(scope);
    return this.mutate(() => {
      if (this.packageOwners(scope).length) {
        throw conflict("Extension scope 仍有 package owner");
      }
      if (scope.kind === "global") {
        throw new Error("Global Extension scope tombstone 不可删除");
      }
      delete this.state.scopeRevisions[scopeKey];
    }, { retireScopeKeys: new Set([scopeKey]) });
  }

  beginDisable(
    input: ExtensionScopeMutation,
    prepare: (
      owner: ExtensionScopeMutationOwner
    ) => Promise<{ operationId: string }>
  ) {
    return this.mutate(async () => {
      const owner = this.scopeMutationOwner(input);
      this.assertLifecycleOwnerAvailable(owner.installIdentity);
      if (this.activeInstallReservation(owner.scope)) {
        throw conflict("Extension scope 被 install reservation 冻结");
      }
      const prepared = await prepare(structuredClone(owner));
      const stored = this.requirePackage(input.installIdentity);
      stored.administrativeState = "disable-pending";
      syncLegacyEnable(stored);
      this.state.lifecycleReceipts.push({
        operationId: prepared.operationId,
        kind: "disable",
        installIdentity: owner.installIdentity,
        sourceIdentity: owner.sourceIdentity,
        scope: structuredClone(owner.scope),
        phase: "pending",
      });
      return structuredClone(
        this.requireLifecycleReceipt(prepared.operationId, "disable")
      );
    });
  }

  resumeBeginDisable(input: {
    operationId: string;
    installIdentity: string;
    scope: ProductResourceScope;
    sourceIdentity: string;
  }) {
    return this.mutate(() => {
      const existing = this.lifecycleReceipt(input.operationId);
      if (existing) {
        assertLifecycleReceipt(existing, input, "disable");
        return;
      }
      this.assertLifecycleOwnerAvailable(input.installIdentity);
      const owner = this.requirePackage(input.installIdentity);
      assertFrozenOwner(owner, input);
      owner.administrativeState = "disable-pending";
      syncLegacyEnable(owner);
      this.state.lifecycleReceipts.push({
        operationId: input.operationId,
        kind: "disable",
        installIdentity: input.installIdentity,
        sourceIdentity: input.sourceIdentity,
        scope: structuredClone(input.scope),
        phase: "pending",
      });
    });
  }

  completeDisable(operationId: string, installIdentity: string) {
    return this.mutate(() => {
      const receipt = this.requireLifecycleReceipt(operationId, "disable");
      if (receipt.installIdentity !== installIdentity) {
        throw conflict("disable lifecycle receipt owner 已漂移");
      }
      if (receipt.phase === "completed") return;
      const owner = this.requirePackage(installIdentity);
      if (owner.administrativeState !== "disable-pending") {
        throw new Error("只有 disable-pending 可收敛为 disabled");
      }
      owner.administrativeState = "denied";
      owner.enabledComponentInstanceIdentities = [];
      syncLegacyEnable(owner);
      receipt.phase = "completed";
    });
  }

  /**
   * 唯一的强引用取得点，因此也是唯一需要关的那道闸：reservation 与逐轮 plan
   * 都从这里拿 ref，卸载一旦挂上 removal-pending，两条路同时关死。
   */
  acquireGenerationRef(ref: ExtensionPackageGenerationRef, ownerId: string) {
    return this.acquireGenerationRefs([ref], ownerId);
  }

  /** Validate the complete set before publishing any owner edge. */
  acquireGenerationRefs(
    refs: readonly ExtensionPackageGenerationRef[],
    ownerId: string
  ) {
    return this.mutate(() => {
      if (!REF_OWNER_PATTERN.test(ownerId)) throw new Error("ref owner id 无效");
      const unique = new Map(
        refs.map((ref) => [refKey(ref)!, structuredClone(ref)])
      );
      const facts = [...unique].map(([key, ref]) => ({
        key,
        ref,
        generationOwner: this.requireGeneration(ref),
        owners: new Set(this.state.refs[key] ?? []),
      }));
      for (const fact of facts) {
        /* 闸只拦新增引用；同 owner replay 是 durable 对账。 */
        if (
          !fact.owners.has(ownerId) &&
          (fact.generationOwner.administrativeState !== "active" ||
            fact.generationOwner.removalPendingGenerationIds.includes(
              fact.ref.packageGenerationId
            ))
        ) {
          throw conflict("package 已关闭 admission，不再签发新的强引用");
        }
      }
      const created: ExtensionPackageGenerationRef[] = [];
      const existed: ExtensionPackageGenerationRef[] = [];
      for (const fact of facts) {
        (fact.owners.has(ownerId) ? existed : created).push(fact.ref);
        fact.owners.add(ownerId);
        this.state.refs[fact.key] = [...fact.owners].sort();
      }
      return { created, existed };
    });
  }

  releaseGenerationRef(ref: ExtensionPackageGenerationRef, ownerId: string) {
    return this.releaseGenerationRefs([ref], ownerId);
  }

  releaseGenerationRefs(
    refs: readonly ExtensionPackageGenerationRef[],
    ownerId: string
  ) {
    return this.mutate(() => {
      for (const ref of refs) {
        const key = refKey(ref)!;
        const owners = (this.state.refs[key] ?? []).filter(
          (item) => item !== ownerId
        );
        if (owners.length) this.state.refs[key] = owners;
        else delete this.state.refs[key];
      }
    });
  }

  blockers(ref: ExtensionPackageGenerationRef) {
    return [...(this.state.refs[refKey(ref)!] ?? [])];
  }

  generationRefsHeldByOwnerPrefix(prefix: string) {
    const held: Array<{
      ref: ExtensionPackageGenerationRef;
      ownerIds: string[];
    }> = [];
    for (const owner of this.state.packages) {
      for (const generation of owner.generations) {
        const ref = generationRef(generation);
        const ownerIds = (this.state.refs[refKey(ref)!] ?? []).filter((item) =>
          item.startsWith(prefix)
        );
        if (ownerIds.length) held.push({ ref, ownerIds });
      }
    }
    return structuredClone(held);
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
  beginPackageRemoval(
    input: ExtensionScopeMutation,
    prepare: (
      owner: ExtensionScopeMutationOwner
    ) => Promise<{ operationId: string }>
  ) {
    return this.mutate(async () => {
      const ownerReceipt = this.scopeMutationOwner(input);
      this.assertLifecycleOwnerAvailable(ownerReceipt.installIdentity);
      if (this.activeInstallReservation(ownerReceipt.scope)) {
        throw conflict("Extension scope 被 install reservation 冻结");
      }
      const current = this.requirePackage(input.installIdentity);
      if (current.administrativeState !== "denied") {
        throw conflict("先停用并完成收敛，才能物理卸载这个 package");
      }
      const prepared = await prepare(structuredClone(ownerReceipt));
      const owner = this.requirePackage(input.installIdentity);
      owner.removalPendingGenerationIds = owner.generations
        .map((item) => item.packageGenerationId)
        .sort();
      this.state.lifecycleReceipts = this.state.lifecycleReceipts.filter(
        (item) =>
          item.installIdentity !== ownerReceipt.installIdentity ||
          item.kind !== "uninstall" ||
          item.phase !== "cancelled"
      );
      this.state.lifecycleReceipts.push({
        operationId: prepared.operationId,
        kind: "uninstall",
        installIdentity: ownerReceipt.installIdentity,
        sourceIdentity: ownerReceipt.sourceIdentity,
        scope: structuredClone(ownerReceipt.scope),
        packageGenerationRefs: owner.generations.map(generationRef),
        removedContentDigests: [],
        phase: "pending",
      });
      return [...owner.removalPendingGenerationIds];
    });
  }

  resumePackageRemoval(input: {
    operationId: string;
    installIdentity: string;
    scope: ProductResourceScope;
    sourceIdentity: string;
  }) {
    return this.mutate(() => {
      const existing = this.lifecycleReceipt(input.operationId);
      if (existing) {
        assertLifecycleReceipt(existing, input, "uninstall");
        return existing.kind === "uninstall"
          ? existing.packageGenerationRefs.map((item) => item.packageGenerationId)
          : [];
      }
      this.assertLifecycleOwnerAvailable(input.installIdentity);
      const owner = this.requirePackage(input.installIdentity);
      assertFrozenOwner(owner, input);
      owner.removalPendingGenerationIds = owner.generations
        .map((item) => item.packageGenerationId)
        .sort();
      this.state.lifecycleReceipts.push({
        operationId: input.operationId,
        kind: "uninstall",
        installIdentity: input.installIdentity,
        sourceIdentity: input.sourceIdentity,
        scope: structuredClone(input.scope),
        packageGenerationRefs: owner.generations.map(generationRef),
        removedContentDigests: [],
        phase: "pending",
      });
      return [...owner.removalPendingGenerationIds];
    });
  }

  /** 放弃卸载：重开准入，包回到「已停用但仍安装」。 */
  cancelPackageRemoval(
    input: ExtensionScopeMutation,
    operationId: string,
    prepare?: (owner: ExtensionScopeMutationOwner) => Promise<void>
  ) {
    return this.mutate(async () => {
      const owner = this.scopeMutationOwner(input);
      const receipt = this.requireLifecycleReceipt(operationId, "uninstall");
      assertLifecycleReceipt(receipt, owner, "uninstall");
      if (receipt.phase === "cancelled") return;
      if (receipt.phase !== "pending") {
        throw conflict("已回收的 package 不能取消卸载");
      }
      await prepare?.(structuredClone(owner));
      this.requirePackage(input.installIdentity).removalPendingGenerationIds = [];
      receipt.phase = "cancelled";
    });
  }

  resumeCancelPackageRemoval(input: {
    operationId: string;
    installIdentity: string;
    scope: ProductResourceScope;
    sourceIdentity: string;
  }) {
    return this.mutate(() => {
      const receipt = this.requireLifecycleReceipt(input.operationId, "uninstall");
      assertLifecycleReceipt(receipt, input, "uninstall");
      if (receipt.phase === "cancelled") return;
      if (receipt.phase !== "pending") {
        throw conflict("已回收的 package 不能取消卸载");
      }
      const owner = this.requirePackage(input.installIdentity);
      assertFrozenOwner(owner, input);
      owner.removalPendingGenerationIds = [];
      receipt.phase = "cancelled";
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
  removePackage(operationId: string, installIdentity: string) {
    return this.mutate(() => {
      const receipt = this.requireLifecycleReceipt(operationId, "uninstall");
      if (receipt.installIdentity !== installIdentity) {
        throw conflict("uninstall lifecycle receipt owner 已漂移");
      }
      if (receipt.phase === "removed") {
        return [...receipt.removedContentDigests];
      }
      if (receipt.phase !== "pending") {
        throw conflict("已取消的 package 卸载不能继续");
      }
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
      const expectedRefs = receipt.packageGenerationRefs.map(refKey).sort();
      const actualRefs = owner.generations.map(generationRef).map(refKey).sort();
      if (expectedRefs.join("\n") !== actualRefs.join("\n")) {
        throw conflict("uninstall lifecycle generation 集合已漂移");
      }
      this.state.packages = this.state.packages.filter(
        (item) => item.installIdentity !== installIdentity
      );
      const retained = new Set(
        this.state.packages.flatMap((item) =>
          item.generations.map((generation) => generation.contentDigest)
        )
      );
      receipt.phase = "removed";
      receipt.removedContentDigests = [...new Set(released)]
        .filter((digest) => !retained.has(digest))
        .sort();
      return [...receipt.removedContentDigests];
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

  isComponentEnabled(componentInstanceIdentity: string) {
    const owner = this.state.packages.find((item) =>
      item.enabledComponentInstanceIdentities.includes(componentInstanceIdentity)
    );
    return owner?.administrativeState === "active";
  }


  private requirePackage(installIdentity: string) {
    const owner = this.state.packages.find((item) => item.installIdentity === installIdentity);
    if (!owner) throw new Error("Extension package 不存在");
    return owner;
  }

  private requireGeneration(ref: ExtensionPackageGenerationRef) {
    const owner = this.state.packages.find((item) =>
      item.generations.some((generation) =>
        generation.packageGenerationId === ref.packageGenerationId &&
        generation.recordDigest === ref.recordDigest
      )
    );
    if (!owner) throw new Error("Extension package generation ref 不存在或 digest 不匹配");
    return owner;
  }

  private packageForActiveComponent(componentInstanceIdentity: string) {
    const owner = this.state.packages.find((item) =>
      item.components.some((component) =>
        component.componentInstanceIdentity === componentInstanceIdentity &&
        refKey(component.packageGenerationRef) === refKey(item.activeGenerationRef)
      )
    );
    if (!owner) throw new Error("active Extension component 不存在");
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
    return this.state.installReservations.find((item) =>
      item.phase === "reserved" && sameProductResourceScope(item.scope, scope)
    );
  }

  private lifecycleReceipt(operationId: string) {
    return this.state.lifecycleReceipts.find((item) => item.operationId === operationId);
  }

  private requireLifecycleReceipt<K extends "disable" | "uninstall">(operationId: string, kind: K): Extract<StoreFile["lifecycleReceipts"][number], { kind: K }> {
    const receipt = this.lifecycleReceipt(operationId);
    if (!receipt || receipt.kind !== kind) throw conflict("Extension lifecycle Registry receipt 不存在或类型不匹配");
    return receipt as Extract<StoreFile["lifecycleReceipts"][number], { kind: K }>;
  }

  private assertLifecycleOwnerAvailable(installIdentity: string) {
    const active = this.state.lifecycleReceipts.find((item) =>
      item.installIdentity === installIdentity && item.phase === "pending"
    );
    if (active) throw conflict("Extension owner 已有 active lifecycle operation");
  }
}

function assertFrozenOwner(owner: StoredPackage, expected: ExtensionScopeMutationOwner) {
  if (
    owner.installIdentity !== expected.installIdentity ||
    owner.sourceIdentity !== expected.sourceIdentity ||
    !sameProductResourceScope(owner.scope, expected.scope)
  ) throw conflict("Extension lifecycle owner receipt 已漂移");
}

function assertLifecycleReceipt(
  receipt: StoreFile["lifecycleReceipts"][number],
  expected: ExtensionScopeMutationOwner & { operationId?: string },
  kind: "disable" | "uninstall"
) {
  if (
    receipt.kind !== kind ||
    (expected.operationId && receipt.operationId !== expected.operationId) ||
    receipt.installIdentity !== expected.installIdentity ||
    receipt.sourceIdentity !== expected.sourceIdentity ||
    !sameProductResourceScope(receipt.scope, expected.scope)
  ) throw conflict("Extension lifecycle Registry receipt identity 已漂移");
}
