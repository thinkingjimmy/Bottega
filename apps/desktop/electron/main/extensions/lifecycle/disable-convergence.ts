/**
 * [INPUT]: Depends on scoped Registry administrative state, projection/lifecycle ledgers, exact-holder revocation, session drain, and cache invalidation ports
 * [OUTPUT]: Provides scope-aware ExtensionDisableConvergence with immediate deny, durable recovery, qualified session admission, and exact-holder drain
 * [POS]: Extension disable coordinator; Project operations affect only that Project while global admission remains conservatively universal
 */

import type {
  ExtensionConvergenceStep,
  ExtensionScopeMutation,
  Sha256Digest,
} from "../../../../shared/extensions-ipc";
import {
  sameProductResourceScope,
  type ProductResourceScope,
  type TurnProjectContext,
} from "../../../../shared/product-resource-scope";
import type { ExtensionRegistryStore } from "../registry-store";
import type { ExtensionLifecycleLedger } from "./lifecycle-ledger";
import type {
  ExtensionProjectionBinding,
  ExtensionProjectionLedger,
} from "./projection-ledger";

/* ============================================================
 * 停用是 deny，不是删除；而 deny 生效与「后端已经看不见它」是两件事。
 *
 * 提交那一刻立即成立的只有三条闸：不再产生新 plan、不再接受新 projection
 * binding、不再启动新的产品会话。真正的收敛要把已经外溢的东西收回来——撤
 * binding、按 refcount 放共享产物、让持旧 discovery snapshot 的会话退出重启、
 * 使 cache 失效。四步全绿才有资格说 `disabled`。
 *
 * 产品没写过的副本不在这条链上：用户自己装的那份只能标 backend-delegated
 * 交回手动处置，说成「产品已撤销」就是在替另一个系统作证。
 * ============================================================ */

/** 物理撤销面；产品写的才删，别人的只如实登记 */
export type ExtensionProjectionRevoker = Readonly<{
  revoke(
    binding: ExtensionProjectionBinding
  ): Promise<"revoked" | "foreign">;
  /** 仅当该内容身份的 refcount 归零才会被调用 */
  releaseArtifact(input: {
    artifactDigest: Sha256Digest;
    targetPath: string;
  }): Promise<void>;
}>;

/** 产品会话面；「退出/重启」由组合根用既有的 rotate/cancel 能力实现 */
export type ExtensionSessionCustody = Readonly<{
  list(input: {
    operationId: string;
    installIdentity: string;
    componentInstanceIdentities: readonly string[];
    workspaceKeys: readonly string[];
    scope: ProductResourceScope;
  }): Promise<readonly ExtensionRuntimeHolder[]>;
  drain(holders: readonly ExtensionRuntimeHolder[]): Promise<void>;
  invalidateDiscoveryCache(scope: ProductResourceScope): void | Promise<void>;
}>;

export type ExtensionRuntimeHolder =
  | Readonly<{
      kind: "conversation";
      conversationId: string;
      session: {
        backend: "codex" | "claude" | "kimi" | "opencode";
        id: string;
      };
    }>
  | Readonly<{ kind: "request"; requestId: string }>
  | Readonly<{ kind: "prepared-request"; requestId: string }>;

export type ExtensionDisableConvergenceFaults = Readonly<{
  afterInitialValidation?: () => void | Promise<void>;
  afterRegistryCommit?: (operationId: string) => void | Promise<void>;
}>;

const STEPS = {
  projection: "projection-binding-revoked",
  artifacts: "shared-artifacts-released",
  sessions: "product-sessions-drained",
  cache: "discovery-cache-invalidated",
} as const satisfies Record<string, ExtensionConvergenceStep>;

export class ExtensionDisableConvergence {
  private revoker: ExtensionProjectionRevoker | null = null;
  private custody: ExtensionSessionCustody | null = null;

  constructor(
    private readonly registry: ExtensionRegistryStore,
    private readonly projections: ExtensionProjectionLedger,
    private readonly ledger: ExtensionLifecycleLedger,
    private readonly faults: ExtensionDisableConvergenceFaults = {}
  ) {}

  /* 撤销面可以缺席——产品未开放 fixed projection 时本就不产生 binding。缺席
     不等于放行：真有 binding 时收敛会 fail closed，而不是当作已撤销。 */
  configure(ports: {
    custody: ExtensionSessionCustody;
    revoker?: ExtensionProjectionRevoker;
  }) {
    this.custody = ports.custody;
    this.revoker = ports.revoker ?? null;
  }

  /**
   * 收敛未完成前不得启动新的产品会话：新会话会从尚未撤干净的 ambient 投影里
   * 重新发现该包，然后把它留在自己的 discovery snapshot 里活到会话结束。
   */
  assertProductSessionAdmission(context: TurnProjectContext) {
    const pending = this.pendingForTurn(context);
    if (!pending.length) return;
    throw Object.assign(
      new Error(
        `EXTENSION_DISABLE_PENDING: 扩展停用收敛未完成（${pending
          .map((item) => item.installIdentity)
          .join("、")}），暂不能启动新的 Agent 会话`
      ),
      { status: 409 }
    );
  }

  productSessionAdmissionClosed(context: TurnProjectContext) {
    return this.pendingForTurn(context).length > 0;
  }

  convergenceOf(installIdentity: string) {
    const operation = this.ledger
      .nonTerminal("disable")
      .find((item) => item.installIdentity === installIdentity);
    if (!operation) return null;
    return {
      operationId: operation.operationId,
      completedSteps: operation.completedSteps as ExtensionConvergenceStep[],
      blocked: operation.blocked?.message ?? null,
    };
  }

  /* 外部副本比收敛活得久：收敛结束不代表它被处置了，界面必须一直看得见。 */
  foreignOccupanciesOf(installIdentity: string) {
    return this.projections.foreignOccupancies(installIdentity).map((item) => ({
      projectionId: item.projectionId,
      componentInstanceIdentity: item.componentInstanceIdentity,
      strength: "backend-delegated" as const,
    }));
  }

  /** 崩溃恢复：非终态的 disable 一律继续推，绝不因为「内存里没这回事」放行。 */
  async resume() {
    for (const operation of this.ledger.nonTerminal("disable")) {
      await this.converge(operation.operationId).catch((cause) => {
        console.warn(
          `[extensions] 停用收敛恢复失败：${operation.installIdentity}`,
          cause
        );
      });
    }
  }

  /* deny 与三道闸在同一次提交里生效，之后才是可重试的收敛。 */
  async beginDisable(input: ExtensionScopeMutation) {
    const { installIdentity } = input;
    this.registry.assertScopeMutation(input);
    await this.faults.afterInitialValidation?.();
    const existing = this.ledger
      .nonTerminal("disable")
      .find((item) => item.installIdentity === installIdentity);
    if (existing) {
      await this.registry.runScopeMutation(input, async () => undefined);
      return this.converge(existing.operationId);
    }
    let operation: ReturnType<ExtensionLifecycleLedger["find"]> = null;
    await this.registry.beginDisable(input, async (authorizedOwner) => {
        const staged = await this.ledger.stage({
          kind: "disable",
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
    if (!committed) throw new Error("Extension disable 缺少 durable operation");
    await this.faults.afterRegistryCommit?.(committed.operationId);
    await this.projections.beginRevoke(installIdentity, committed.operationId);
    await this.ledger.advance(committed.operationId, committed.revision, "converging");
    await this.converge(committed.operationId);
  }

  private async converge(operationId: string) {
    const started = this.ledger.find(operationId);
    if (!started || started.phase === "completed" || started.phase === "aborted") {
      return;
    }
    const installIdentity = started.installIdentity;
    /* 恢复路径可能停在 staged：deny 与 binding 撤销都要幂等地补上。 */
    if (this.administrativeState(installIdentity) === "active") {
      await this.registry.resumeBeginDisable({
        operationId,
        installIdentity,
        scope: started.scope,
        sourceIdentity: started.sourceIdentity,
      });
    }
    /* Registry gate 与 projection ledger 是两本 durable 账；无论 gate 是否已写，
       都按同一 operationId 幂等补 revoke，不能从 disable-pending 猜它已完成。 */
    await this.projections.beginRevoke(installIdentity, operationId);
    if (started.phase === "staged") {
      await this.ledger.advance(operationId, started.revision, "converging");
    }
    try {
      await this.drainSessions(operationId);
      await this.revokeBindings(operationId);
      await this.releaseArtifacts(operationId);
      await this.invalidateCaches(operationId);
    } catch (cause) {
      /* 收敛卡住就停在 disable-pending 并把原因说出口——绝不跳到 disabled。 */
      await this.ledger.block(operationId, {
        code: "convergence-failed",
        message: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    }
    await this.registry.completeDisable(operationId, installIdentity);
    const settled = this.ledger.find(operationId)!;
    await this.ledger.advance(operationId, settled.revision, "completed");
  }

  /* 按 operationId 而不是按包收窄：撤销面要处理的正是**这一次**拽下来的那些
     binding——同一个包可能同时背着别的收敛留下的 revoke-pending。 */
  private async revokeBindings(operationId: string) {
    if (this.hasStep(operationId, STEPS.projection)) return;
    const pending = this.projections.pendingRevocations(operationId);
    if (pending.length && !this.revoker) {
      throw new Error("存在 projection binding 但未装配撤销面，拒绝冒充已撤销");
    }
    for (const binding of pending) {
      await this.projections.settleRevoke(
        binding.bindingId,
        await this.revoker!.revoke(binding)
      );
    }
    await this.ledger.recordStep(operationId, STEPS.projection);
  }

  /* 共享产物按内容 refcount：还有别的 binding 指着同一份字节就绝不回收，
     哪怕那条 binding 属于另一个包、另一个 owner、另一轮。 */
  private async releaseArtifacts(operationId: string) {
    if (this.hasStep(operationId, STEPS.artifacts)) return;
    const revoked = this.projections.settledRevocations(operationId);
    if (revoked.length && !this.revoker) {
      throw new Error("有待释放的共享产物但未装配撤销面，拒绝冒充已清理");
    }
    for (const binding of revoked) {
      if (this.projections.artifactHolders(binding.artifactDigest).length) continue;
      await this.revoker!.releaseArtifact({
        artifactDigest: binding.artifactDigest,
        targetPath: binding.targetPath,
      });
    }
    await this.ledger.recordStep(operationId, STEPS.artifacts);
  }

  /* ambient binding、manual Skill custody 与 App plan 都是独立 owner。统一读面
     按 exact install/component 汇总，不能把「没有 workspace binding」当作零持有者。 */
  private async drainSessions(operationId: string) {
    if (this.hasStep(operationId, STEPS.sessions)) return;
    if (!this.custody) {
      throw new Error("未装配 exact-holder 会话面，拒绝冒充已收敛");
    }
    const operation = this.ledger.find(operationId)!;
    const workspaces = this.projections.affectedWorkspaces(operationId);
    const owner = this.registry.packageInventory(operation.installIdentity);
    if (!owner) throw new Error("停用收敛找不到 exact package owner");
    const holders = await this.custody.list({
      operationId,
      installIdentity: operation.installIdentity,
      componentInstanceIdentities: owner.components.map(
        (component) => component.componentInstanceIdentity
      ),
      workspaceKeys: workspaces,
      scope: operation.scope,
    });
    if (holders.length) await this.custody.drain(holders);
    await this.ledger.recordStep(operationId, STEPS.sessions);
  }

  private async invalidateCaches(operationId: string) {
    if (this.hasStep(operationId, STEPS.cache)) return;
    if (!this.custody) {
      throw new Error("未装配会话面，无法证明 discovery cache 已失效");
    }
    const operation = this.ledger.find(operationId)!;
    await this.custody.invalidateDiscoveryCache(operation.scope);
    await this.ledger.recordStep(operationId, STEPS.cache);
  }

  private hasStep(operationId: string, step: ExtensionConvergenceStep) {
    return Boolean(this.ledger.find(operationId)?.completedSteps.includes(step));
  }

  private administrativeState(installIdentity: string) {
    return this.registry.packageInventory(installIdentity)?.administrativeState;
  }

  private pendingForTurn(context: TurnProjectContext) {
    return this.ledger.nonTerminal("disable").filter((operation) => {
      if (operation.scope.kind === "global") return true;
      return Boolean(
        context.projectId &&
          sameProductResourceScope(operation.scope, {
            kind: "project",
            projectId: context.projectId,
          })
      );
    });
  }
}
