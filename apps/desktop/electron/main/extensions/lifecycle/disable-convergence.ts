/**
 * [INPUT]: Depends on ExtensionRegistryStore's administrativeState Truth, projection ledger, lifecycle ledger with the combination of root-injected withdrawal/session two narrow ports
 * [OUTPUT]: Provides ExtensionDisableConvergence: deny is effective immediately, four steps to restore convergence, product sessions are accessed with foreign and digital access
 * [POS]: The execution of the extensions/lifecycle is done by the execution of the extensions/lifecycleBefore the full green, administrativeState can only be stopped in disable-pending
 */

import type {
  ExtensionConvergenceStep,
  Sha256Digest,
} from "../../../../shared/extensions-ipc";
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
  list(workspaceKeys: readonly string[]): Promise<readonly string[]>;
  drain(sessionIds: readonly string[]): Promise<void>;
  invalidateDiscoveryCache(): void | Promise<void>;
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
    private readonly ledger: ExtensionLifecycleLedger
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
  assertProductSessionAdmission() {
    const pending = this.ledger.nonTerminal("disable");
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

  productSessionAdmissionClosed() {
    return this.ledger.nonTerminal("disable").length > 0;
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
      componentIdentity: item.componentIdentity,
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
  async beginDisable(installIdentity: string) {
    const existing = this.ledger
      .nonTerminal("disable")
      .find((item) => item.installIdentity === installIdentity);
    const operation =
      existing ?? (await this.ledger.stage({ kind: "disable", installIdentity }));
    if (!existing) {
      try {
        await this.registry.beginDisable(installIdentity);
        await this.projections.beginRevoke(installIdentity, operation.operationId);
        await this.ledger.advance(operation.operationId, operation.revision, "converging");
      } catch (cause) {
        /* deny 都没提交成功（比如根本没这个包），这条操作就不该存在——留着它
           会让「收敛未完成」这道会话闸永久关死在一次输入错误上。 */
        await this.ledger.abort(operation.operationId);
        throw cause;
      }
    }
    await this.converge(operation.operationId);
  }

  private async converge(operationId: string) {
    const started = this.ledger.find(operationId);
    if (!started || started.phase === "completed" || started.phase === "aborted") {
      return;
    }
    const installIdentity = started.installIdentity;
    /* 恢复路径可能停在 staged：deny 与 binding 撤销都要幂等地补上。 */
    if (this.administrativeState(installIdentity) === "active") {
      await this.registry.beginDisable(installIdentity);
      await this.projections.beginRevoke(installIdentity, operationId);
    }
    if (started.phase === "staged") {
      await this.ledger.advance(operationId, started.revision, "converging");
    }
    try {
      await this.revokeBindings(operationId);
      await this.releaseArtifacts(operationId);
      await this.drainSessions(operationId);
      await this.invalidateCaches(operationId);
    } catch (cause) {
      /* 收敛卡住就停在 disable-pending 并把原因说出口——绝不跳到 disabled。 */
      await this.ledger.block(operationId, {
        code: "convergence-failed",
        message: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    }
    await this.registry.completeDisable(installIdentity);
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

  /* 只有 ambient 投影会进入会话的 discovery snapshot；manual snapshot 是逐轮
     注入，随本轮结束而结束，因此受影响面精确到「有过 binding 的 workspace」。 */
  private async drainSessions(operationId: string) {
    if (this.hasStep(operationId, STEPS.sessions)) return;
    const workspaces = this.projections.affectedWorkspaces(operationId);
    if (workspaces.length) {
      if (!this.custody) {
        throw new Error("存在受影响 workspace 但未装配会话面，拒绝冒充已收敛");
      }
      const sessions = await this.custody.list(workspaces);
      if (sessions.length) await this.custody.drain(sessions);
    }
    await this.ledger.recordStep(operationId, STEPS.sessions);
  }

  private async invalidateCaches(operationId: string) {
    if (this.hasStep(operationId, STEPS.cache)) return;
    if (!this.custody) {
      throw new Error("未装配会话面，无法证明 discovery cache 已失效");
    }
    await this.custody.invalidateDiscoveryCache();
    await this.ledger.recordStep(operationId, STEPS.cache);
  }

  private hasStep(operationId: string, step: ExtensionConvergenceStep) {
    return Boolean(this.ledger.find(operationId)?.completedSteps.includes(step));
  }

  private administrativeState(installIdentity: string) {
    return this.registry
      .snapshot()
      .packages.find((item) => item.installIdentity === installIdentity)
      ?.administrativeState;
  }
}
