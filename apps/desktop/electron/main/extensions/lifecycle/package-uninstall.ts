/**
 * [INPUT]: Depends on exact-scope Registry removal fences, projection leases, retained-data owner receipts, App migration, and runtime custody ports
 * [OUTPUT]: Provides scope-authorized package uninstall, durable reference convergence, byte reclamation, retained-owner projection, and explicit exact-owner data purge
 * [POS]: Extension physical uninstall coordinator; frozen generations retain code while install-owned data survives package removal until separately purged
 */

import type {
  ExtensionAffectedAppView,
  ExtensionPackageGenerationRef,
  ExtensionScopeMutation,
  ExtensionUninstallStep,
  ExtensionUninstallView,
} from "../../../../shared/extensions-ipc";
import {
  sameProductResourceScope,
  type ProductResourceScope,
} from "../../../../shared/product-resource-scope";
import { extensionContentStore } from "../content-store";
import type { ExtensionRegistryStore } from "../registry-store";
import type { ExtensionLifecycleLedger } from "./lifecycle-ledger";
import type { PluginDataEpochStore } from "./plugin-data-epochs";
import type { ExtensionProjectionLedger } from "./projection-ledger";

/* ============================================================
 * 卸载是可恢复 mutation，不是一次 rm -rf。
 *
 * 顺序是硬的：先关闸（不再签发新的 reservation / plan / projection 强引用），
 * 再把仍然存在的 durable 引用**列给用户**去解决，然后等运行期的 lease 与
 * custody 自己归零，最后才回收代与字节。
 *
 * 两条最容易被抄近路的红线：
 * ① 任一 frozen App generation 仍精确引用某一代时，绝不物理删除。用户不迁移，
 *    这个包就只能保持「已停用但仍安装」——产品无权把旧的 frozen graph 原地
 *    改写成 degraded，那等于替用户重新解释他当初批准过的东西。
 * ② package 代码回收不顺手删 install-owned data epoch。数据删除是全部
 *    generation/custody 归零之后的**独立、显式**动作。
 * ============================================================ */

/** 进程 / transport custody 面；缺席即 fail closed，绝不冒充已归零 */
export type ExtensionRuntimeCustodyProbe = Readonly<{
  outstanding(
    installIdentity: string
  ): readonly string[] | Promise<readonly string[]>;
}>;

/** 迁移面；与更新共用同一个实现，卸载只是换了一份 authoritative snapshot */
export type ExtensionUninstallMigrationPort = Readonly<{
  boundApps(
    refs: readonly ExtensionPackageGenerationRef[]
  ): readonly ExtensionAffectedAppView[];
  migrate(appId: string, migrationId: string): Promise<void>;
}>;

const STEPS = {
  references: "durable-references-resolved",
  custody: "runtime-custody-drained",
  generations: "package-generations-removed",
  bytes: "package-bytes-collected",
} as const satisfies Record<string, ExtensionUninstallStep>;

/** reservation 持有的强引用由 boundApps 那一行代表，不在「其它 owner」里重复出现 */
const RESERVATION_OWNER = "app-reservation:";

export type ExtensionPackageUninstallFaults = Readonly<{
  afterInitialValidation?: (
    action: "begin" | "resolve" | "cancel" | "purge"
  ) => void | Promise<void>;
  afterRegistryCommit?: (operationId: string) => void | Promise<void>;
  afterPackageBytesRemoved?: (operationId: string) => void | Promise<void>;
}>;

export class ExtensionPackageUninstall {
  private custody: ExtensionRuntimeCustodyProbe | null = null;
  private migrations: ExtensionUninstallMigrationPort | null = null;
  private readonly contentStore: ReturnType<typeof extensionContentStore>;

  constructor(
    private readonly registry: ExtensionRegistryStore,
    private readonly projections: ExtensionProjectionLedger,
    private readonly epochs: PluginDataEpochStore,
    private readonly ledger: ExtensionLifecycleLedger,
    packagesRoot: string,
    private readonly faults: ExtensionPackageUninstallFaults = {}
  ) {
    this.contentStore = extensionContentStore(packagesRoot);
  }

  configure(ports: {
    custody: ExtensionRuntimeCustodyProbe;
    migrations?: ExtensionUninstallMigrationPort;
  }) {
    this.custody = ports.custody;
    this.migrations = ports.migrations ?? null;
  }

  /** 崩溃恢复：非终态的卸载一律继续推，绝不因为「内存里没这回事」放行。 */
  async resume() {
    for (const operation of this.ledger.snapshot()) {
      if (operation.kind !== "uninstall" || operation.phase !== "aborted") continue;
      if (
        this.ledger
          .nonTerminal("uninstall")
          .some((item) => item.installIdentity === operation.installIdentity)
      ) {
        continue;
      }
      await this.registry.resumeCancelPackageRemoval({
        operationId: operation.operationId,
        installIdentity: operation.installIdentity,
        scope: operation.scope,
        sourceIdentity: operation.sourceIdentity,
      }).catch((cause) => {
        if (this.registry.packageInventory(operation.installIdentity)) throw cause;
      });
    }
    for (const operation of this.ledger.nonTerminal("uninstall")) {
      await this.converge(operation.operationId).catch((cause) => {
        console.warn(
          `[extensions] 物理卸载恢复失败：${operation.installIdentity}`,
          cause
        );
      });
    }
  }

  /**
   * 关闸并落账。要求包已经收敛为 `disabled`——停用是 deny，卸载是删除，把两件
   * 事挤进一个动作会让「我只是不想它现在生效」变成不可逆。
   */
  async begin(input: ExtensionScopeMutation) {
    const { installIdentity } = input;
    this.registry.assertScopeMutation(input);
    await this.faults.afterInitialValidation?.("begin");
    const existing = this.operationOf(installIdentity);
    if (existing) {
      await this.registry.runScopeMutation(input, async () => undefined);
      return this.converge(existing.operationId);
    }
    const owner = this.registry.packageInventory(installIdentity);
    if (!owner) throw new Error("Extension package 不存在");
    if (owner.administrativeState !== "denied") {
      throw conflict("先停用并完成收敛，才能物理卸载这个 package");
    }
    let operation: ReturnType<ExtensionLifecycleLedger["find"]> = null;
    await this.registry.beginPackageRemoval(input, async (authorizedOwner) => {
        const staged = await this.ledger.stage({
          kind: "uninstall",
          installIdentity,
          scope: authorizedOwner.scope,
          sourceIdentity: authorizedOwner.sourceIdentity,
          expectedProjectLifecycleRevision: input.expectedProjectLifecycleRevision,
          expectedScopeRevision: input.expectedScopeRevision,
        });
        operation = staged;
        return { operationId: staged.operationId };
      });
    const committed = operation as ReturnType<ExtensionLifecycleLedger["find"]>;
    if (!committed) throw new Error("Extension uninstall 缺少 durable operation");
    await this.faults.afterRegistryCommit?.(committed.operationId);
    await this.projections.beginRevoke(installIdentity, committed.operationId);
    await this.ledger.advance(
      committed.operationId,
      committed.revision,
      "converging"
    );
    await this.converge(committed.operationId);
  }

  /** 用户逐个选择迁移；点名之外的 App 继续指向旧代，绝不原地换绑。 */
  async resolve(input: ExtensionScopeMutation & {
    migrateAppIds?: readonly string[];
  }) {
    this.registry.assertScopeMutation(input);
    await this.faults.afterInitialValidation?.("resolve");
    const operation = this.operationOf(input.installIdentity);
    if (!operation) throw new Error("该 package 没有进行中的卸载");
    const known = new Set(this.boundApps(input.installIdentity).map((item) => item.appId));
    await this.registry.runScopeMutation(input, async () => {
      for (const appId of input.migrateAppIds ?? []) {
        if (!this.migrations || !known.has(appId)) {
          throw new Error("迁移名单包含未绑定该 package 的 App");
        }
        await this.migrations.migrate(
          appId,
          `extension-uninstall:${operation.operationId}:${appId}`
        );
      }
    });
    await this.converge(operation.operationId);
  }

  /** 放弃卸载：重开准入，包回到「已停用但仍安装」，一个字节都没少。 */
  async cancel(input: ExtensionScopeMutation) {
    const { installIdentity } = input;
    this.registry.assertScopeMutation(input);
    await this.faults.afterInitialValidation?.("cancel");
    const operation = this.operationOf(installIdentity);
    if (!operation) return;
    await this.registry.cancelPackageRemoval(input, operation.operationId, async () => {
      await this.ledger.abort(operation.operationId);
    });
  }

  async viewOf(installIdentity: string): Promise<ExtensionUninstallView | null> {
    const operation = this.operationOf(installIdentity);
    if (!operation) return null;
    const outstanding = this.projections.outstanding(installIdentity);
    return {
      operationId: operation.operationId,
      completedSteps: operation.completedSteps as ExtensionUninstallStep[],
      blocked: operation.blocked?.message ?? null,
      boundApps: this.boundApps(installIdentity),
      otherOwners: this.otherOwners(installIdentity),
      projectionLeases: outstanding.leases.length,
      sharedArtifacts: outstanding.sharedArtifacts,
      custody: [...((await this.custody?.outstanding(installIdentity)) ?? [])],
    };
  }

  /**
   * package 已回收、数据仍在盘上的安装。
   *
   * 它必须一直显示：把它藏起来等于让用户以为「卸载 = 什么都没剩下」，而下一次
   * 装同一个仓库时那份旧数据会原样回来。
   */
  async retainedInstallData(scope: ProductResourceScope) {
    const installed = new Set(
      this.registry.packageOwners(scope).map((item) => item.installIdentity)
    );
    const rows = [];
    for (const owner of await this.epochs.listOwners(scope)) {
      const { installIdentity } = owner;
      if (installed.has(installIdentity)) continue;
      rows.push({
        installIdentity,
        scope: owner.scope,
        sourceIdentity: owner.sourceIdentity,
        displayLabel:
          owner.displayLabel ?? installIdentity.replace(/^sha256:/, "").slice(0, 12),
        sourceLabel: owner.sourceLabel ?? null,
        epochIds: await this.epochs.listEpochs(installIdentity),
        custody: [...(await this.custody?.outstanding(installIdentity) ?? [])],
      });
    }
    return rows;
  }

  /** 独立、显式的最终数据删除；package 还在或 custody 未归零一律拒绝。 */
  async purgeInstallData(input: ExtensionScopeMutation) {
    const { installIdentity } = input;
    if (this.registry.scopeRevision(input.expectedScope) !== input.expectedScopeRevision) {
      throw conflict("Extension scope revision 已变更");
    }
    await this.faults.afterInitialValidation?.("purge");
    await this.registry.runScopeRevisionMutation(
      input.expectedScope,
      input.expectedScopeRevision,
      async () => {
        const installed = Boolean(this.registry.packageInventory(installIdentity));
        if (installed) throw conflict("package 尚未回收，不能删除 install-owned 数据");
        if (!this.custody) throw new Error("未装配 custody 探针，拒绝冒充已归零");
        const outstanding = await this.custody.outstanding(installIdentity);
        if (outstanding.length) {
          throw conflict(`仍有未归零的 custody：${outstanding.join("、")}`);
        }
        const owner = await this.epochs.owner(installIdentity);
        if (!owner || !sameProductResourceScope(owner.scope, input.expectedScope)) {
          throw conflict("install-owned data 不属于目标 scope");
        }
        await this.epochs.purgeInstallData(owner);
      }
    );
  }

  private async converge(operationId: string) {
    const started = this.ledger.find(operationId);
    if (!started || started.phase === "completed" || started.phase === "aborted") {
      return;
    }
    const installIdentity = started.installIdentity;
    /* 恢复路径可能停在 staged：关闸要幂等地补上。已经关全（或者代都回收完了、
       闸的问题不再存在）就别再写一遍账——那会白白推高 inventory revision，更会
       在「代已删、字节未收」的恢复点上撞进「package 不存在」。 */
    if (!this.gateClosed(installIdentity)) {
      await this.registry.resumePackageRemoval({
        operationId,
        installIdentity,
        scope: started.scope,
        sourceIdentity: started.sourceIdentity,
      });
    }
    await this.projections.beginRevoke(installIdentity, operationId);
    if (started.phase === "staged") {
      await this.ledger.advance(operationId, started.revision, "converging");
    }
    try {
      await this.assertReferencesResolved(operationId, installIdentity);
      await this.assertCustodyDrained(operationId, installIdentity);
      await this.removeGenerations(operationId, installIdentity);
      await this.collectBytes(operationId);
    } catch (cause) {
      /* 卸载卡住就停在原地并把原因说出口——它是账上一条待办，不是失败。 */
      await this.ledger.block(operationId, {
        code: "uninstall-blocked",
        message: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    }
    const settled = this.ledger.find(operationId)!;
    await this.ledger.advance(operationId, settled.revision, "completed");
  }

  /* prepared reservation、committed App-generation ref 与其它 owner 都是 durable
     引用：产品自己解决不了，只能列给用户。 */
  private async assertReferencesResolved(
    operationId: string,
    installIdentity: string
  ) {
    if (this.hasStep(operationId, STEPS.references)) return;
    const apps = this.boundApps(installIdentity);
    const others = this.otherOwners(installIdentity);
    if (apps.length || others.length) {
      throw new Error(
        `仍有未解决的 durable 引用：${[
          ...apps.map((item) => `App ${item.appId}@${item.appGenerationId}`),
          ...others,
        ].join("、")}`
      );
    }
    await this.ledger.recordStep(operationId, STEPS.references);
  }

  /* 运行期这一侧产品等得起：plan lease 随本轮结束归还，projection lease 随
     drain 归零，进程/transport custody 由 custody 面如实回答。 */
  private async assertCustodyDrained(
    operationId: string,
    installIdentity: string
  ) {
    if (this.hasStep(operationId, STEPS.custody)) return;
    const projections = this.projections.outstanding(installIdentity);
    if (projections.bindings.length || projections.leases.length) {
      throw new Error(
        `仍有 ${projections.bindings.length} 条未撤销的 projection binding 与 ${projections.leases.length} 个未归还的 lease`
      );
    }
    if (!this.custody) throw new Error("未装配 custody 探针，拒绝冒充已归零");
    const outstanding = await this.custody.outstanding(installIdentity);
    if (outstanding.length) {
      throw new Error(`仍有未归零的进程/transport custody：${outstanding.join("、")}`);
    }
    await this.ledger.recordStep(operationId, STEPS.custody);
  }

  private async removeGenerations(operationId: string, installIdentity: string) {
    if (this.hasStep(operationId, STEPS.generations)) return;
    await this.registry.removePackage(operationId, installIdentity);
    await this.ledger.recordStep(operationId, STEPS.generations);
  }

  /**
   * 字节回收从**当前权威状态**推导，而不是从「上一步记下的那几个 digest」：
   * 崩在两步之间时，前者照样算得出正确答案，后者只剩一张过期清单。
   *
   * 仍被任一代引用、或仍被另一条未走完的生命周期操作占着的内容根，一律留着。
   */
  private async collectBytes(operationId: string) {
    if (this.hasStep(operationId, STEPS.bytes)) return;
    const retained = new Set([
      ...this.registry.referencedContentDigests(),
      ...this.ledger
        .nonTerminal()
        .flatMap((item) => (item.contentDigest ? [item.contentDigest] : [])),
    ]);
    await this.contentStore.collect(retained, () =>
      this.faults.afterPackageBytesRemoved?.(operationId)
    );
    await this.ledger.recordStep(operationId, STEPS.bytes);
  }

  /* 迁移面缺席时不能声称「没有 App 绑着」：那一类 blocker 会如实落到
     otherOwners 里，卸载因此停住，而不是把一个还有人用的包删掉。 */
  private boundApps(installIdentity: string) {
    return this.migrations
      ? this.migrations.boundApps(this.registry.packageGenerationRefs(installIdentity))
      : [];
  }

  private otherOwners(installIdentity: string) {
    const owners = this.registry
      .packageGenerationRefs(installIdentity)
      .flatMap((ref) => this.registry.blockers(ref));
    return [...new Set(owners)]
      .filter((owner) => !this.migrations || !owner.startsWith(RESERVATION_OWNER))
      .sort();
  }

  private gateClosed(installIdentity: string) {
    const owner = this.registry.packageInventory(installIdentity);
    if (!owner) return true;
    return owner.generations.every((item) =>
      owner.removalPendingGenerationIds.includes(item.packageGenerationId)
    );
  }

  private operationOf(installIdentity: string) {
    return (
      this.ledger
        .nonTerminal("uninstall")
        .find((item) => item.installIdentity === installIdentity) ?? null
    );
  }

  private hasStep(operationId: string, step: ExtensionUninstallStep) {
    return Boolean(this.ledger.find(operationId)?.completedSteps.includes(step));
  }
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}
