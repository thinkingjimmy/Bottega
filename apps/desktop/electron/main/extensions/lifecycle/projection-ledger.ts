/**
 * [INPUT]: Depends on DurableJson, zod, exact Extension package inventory, component-instance/generation identity, and projection owners
 * [OUTPUT]: Provides schema-v5 ambient-projection custody, exact binding session receipts, and operation-frozen holder queries
 * [POS]: Durable projection authority; component-instance identity prevents same-declared-component owners from sharing consent or lifecycle state
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type ExtensionPackageGenerationRef,
  type ExtensionProjectionOwner,
  type Sha256Digest,
} from "../../../../shared/extensions-ipc";
import { DurableJson } from "../../persistence/durable-json";
import type { ExtensionRegistryStore } from "../registry-store";
import type { TurnProjectContext } from "../../../../shared/product-resource-scope";
import {
  projectionLedgerSchema,
  type ExtensionBindingAuthority,
  type ExtensionProjectionBinding,
  type ExtensionProjectionLease,
  type ExtensionWorkspaceConsent,
  type ProjectionAdmission,
  type ProjectionDelivery,
  type ProjectionLedgerState,
} from "./projection-ledger-schema";
export type {
  ExtensionBindingAuthority,
  ExtensionProjectionBinding,
  ExtensionProjectionLease,
  ExtensionWorkspaceConsent,
} from "./projection-ledger-schema";

/* ============================================================
 * 投影有两层引用计数，混成一层就一定错。
 *
 * ① **owner refcount**：谁还同意这份字节留在这个 workspace。用户、App A、
 *    App B 各自持有独立的 workspace consent；最后一个 owner 撤出，binding 才
 *    失去存在理由。它绝不从 AppReferenceLease 推导——那条 lease 只说明「本轮
 *    这个 App 在场」，把它当同意，等于让打开一次 App 就改写了文件系统授权。
 *
 * ② **lease refcount**：谁正在读这份字节。逐实例、短命，只负责在撤销与读取
 *    之间挡一道；lease 归零不意味着投影该消失——ambient 投影本来就活过本轮。
 *
 * 再加上跨包的 **artifact refcount**（按内容算）：一轮 cleanup 永远不能回收
 * 另一个 owner 仍指着的同一份字节。
 * ============================================================ */

export type GrantWorkspaceConsentInput = Readonly<{
  owner: ExtensionProjectionOwner;
  workspaceKey: string;
  workspaceCapabilityId: string;
  canonicalIdentityDigest: Sha256Digest;
}>;

export type AcquireProjectionInput = Readonly<{
  owner: ExtensionProjectionOwner;
  installIdentity: string;
  packageGenerationRef: ExtensionPackageGenerationRef;
  componentInstanceIdentity: string;
  delivery: ProjectionDelivery;
  projectionId: string;
  workspaceKey: string;
  targetPath: string;
  artifactDigest: Sha256Digest;
}>;

/** 仍持有引用的两种状态：active 是正在服务，revoke-pending 是还没撤干净。 */
const HOLDING: readonly ExtensionProjectionBinding["state"][] = [
  "active",
  "revoke-pending",
];

export class ExtensionProjectionLedger {
  private readonly file: DurableJson<ProjectionLedgerState>;

  constructor(
    userData: string,
    private readonly registry: ExtensionRegistryStore
  ) {
    this.file = new DurableJson(
      join(userData, "agent-extensions", "projections.json"),
      projectionLedgerSchema,
      () => ({ schemaVersion: 5 as const, consents: [], bindings: [], sessionDiscoveries: [], projectionAdmissions: [], authorities: [] })
    );
  }

  get filePath() {
    return this.file.filePath;
  }

  /** Cutover: pre-v5 ledgers fail closed; discovery authority domains are not inferred. */
  initialize() {
    return this.file.initialize();
  }

  /**
   * 独立的 workspace consent：**逐 owner** 授予，与 App 的 extension grant、
   * AppReferenceLease 全无推导关系。同一 owner 对同一 workspace 身份重复授予
   * 是幂等的；workspace 身份变了就是另一份同意。
   */
  grantWorkspaceConsent(input: GrantWorkspaceConsentInput, now = Date.now()) {
    return this.file.mutate((state) => {
      const existing = state.consents.find(
        (item) =>
          item.revokedAt === null &&
          sameOwner(item.owner, input.owner) &&
          item.workspaceKey === input.workspaceKey &&
          item.canonicalIdentityDigest === input.canonicalIdentityDigest
      );
      if (existing) return existing;
      const consent: ExtensionWorkspaceConsent = {
        ...structuredClone(input as GrantWorkspaceConsentInput),
        consentId: randomUUID(),
        grantedAt: now,
        revokedAt: null,
      };
      state.consents.push(consent);
      return consent;
    });
  }

  /**
   * 撤回同意：该 owner 立刻不再签发新 lease，并从每条 binding 的 owner 集合
   * 退出。失去最后一个 owner 的 binding 转 `revoke-pending`，由调用方的收敛
   * 真正撤下来——账上先如实记「没人再同意了」，绝不假装文件已经不在。
   */
  revokeWorkspaceConsent(
    input: {
      owner: ExtensionProjectionOwner;
      workspaceKey: string;
      operationId: string;
    },
    now = Date.now()
  ) {
    return this.file.mutate((state) => {
      for (const consent of state.consents) {
        if (
          consent.revokedAt === null &&
          sameOwner(consent.owner, input.owner) &&
          consent.workspaceKey === input.workspaceKey
        ) {
          consent.revokedAt = now;
        }
      }
      const orphaned: ExtensionProjectionBinding[] = [];
      for (const binding of state.bindings) {
        if (
          binding.workspaceKey !== input.workspaceKey ||
          !HOLDING.includes(binding.state)
        ) {
          continue;
        }
        binding.owners = binding.owners.filter(
          (item) => !sameOwner(item, input.owner)
        );
        if (binding.owners.length || binding.state !== "active") continue;
        binding.state = "revoke-pending";
        binding.revokedByOperationId = input.operationId;
        orphaned.push(binding);
      }
      return structuredClone(orphaned);
    });
  }

  activeConsents(owner: ExtensionProjectionOwner) {
    return this.file
      .snapshot()
      .consents.filter(
        (item) => item.revokedAt === null && sameOwner(item.owner, owner)
      );
  }

  /** 投影准入是独立安全位，不借 `$` catalog 的候选开关表达另一件事。 */
  admitProjectionComponent(input: Omit<ProjectionAdmission, "admittedAt">, now = Date.now()) {
    return this.file.mutate((state) => {
      const existing = state.projectionAdmissions.find((item) =>
        item.installIdentity === input.installIdentity &&
        item.packageGenerationRef.packageGenerationId === input.packageGenerationRef.packageGenerationId &&
        item.packageGenerationRef.recordDigest === input.packageGenerationRef.recordDigest &&
        item.componentInstanceIdentity === input.componentInstanceIdentity
      );
      if (existing) return existing;
      const admission = { ...structuredClone(input), admittedAt: now };
      state.projectionAdmissions.push(admission);
      return admission;
    });
  }

  revokeProjectionComponent(componentInstanceIdentity: string) {
    return this.file.mutate((state) => {
      state.projectionAdmissions = state.projectionAdmissions.filter(
        (item) => item.componentInstanceIdentity !== componentInstanceIdentity
      );
    });
  }

  /** authority 一次只授权一个精确 action；批量由调用方逐条列出后逐条签发。 */
  authorizeBindingAction(input: Omit<ExtensionBindingAuthority, "authorityToken" | "expiresAt" | "consumedAt">, now = Date.now()) {
    return this.file.mutate((state) => {
      const authority: ExtensionBindingAuthority = {
        ...structuredClone(input),
        authorityToken: randomUUID(),
        expiresAt: now + 5 * 60_000,
        consumedAt: null,
      };
      state.authorities.push(authority);
      return { authorityToken: authority.authorityToken, expiresAt: authority.expiresAt };
    });
  }

  /**
   * 取得投影：同一目标已有 binding 就**加入**它（多 owner 共享一份字节），
   * 内容不同才是真冲突。创建与签发 lease 在同一次 mutate 里完成——分成两步
   * 会留下「有 binding 没有任何 owner」的孤儿，那种投影谁都撤不掉。
   */
  acquireProjection(input: AcquireProjectionInput, now = Date.now()) {
    return this.file.mutate((state) => {
      this.assertPackageAdmits(state, input);
      const consent = state.consents.find(
        (item) =>
          item.revokedAt === null &&
          sameOwner(item.owner, input.owner) &&
          item.workspaceKey === input.workspaceKey
      );
      /* 没有独立同意就没有投影。持有 AppReferenceLease 不是同意的证据，
         这里也拿不到那条 lease——授权边在类型上就断开了。 */
      if (!consent) {
        throw conflict("缺少该 owner 对此 workspace 的独立 projection consent");
      }
      const binding = this.joinOrCreate(state.bindings, input);
      const lease: ExtensionProjectionLease = {
        leaseId: randomUUID(),
        owner: structuredClone(input.owner) as ExtensionProjectionOwner,
        workspaceConsentId: consent.consentId,
        acquiredAt: now,
      };
      binding.leases.push(lease);
      return { binding: structuredClone(binding), leaseId: lease.leaseId };
    });
  }

  /**
   * A backend session discovers only bindings active when that session is
   * bound. Later bindings do not retroactively make an old session a holder.
   */
  recordSessionDiscovery(input: {
    conversationId: string;
    requestId: string;
    backendRuntimeIdentity: string;
    projectContext: TurnProjectContext;
    session: { backend: "codex" | "claude" | "kimi" | "opencode"; id: string };
    discoveries: readonly Readonly<{
      kind: "ambient-projection";
      authorityId: string;
      packageGenerationRef: ExtensionPackageGenerationRef;
      componentInstanceIdentity: string;
      deliveryIdentity: Sha256Digest;
    }>[];
  }, now = Date.now()) {
    return this.file.mutate((state) => {
      for (const receipt of state.sessionDiscoveries) {
        if (
          receipt.conversationId === input.conversationId &&
          receipt.releasedAt === null &&
          (receipt.backend !== input.session.backend ||
            receipt.sessionId !== input.session.id)
        ) {
          receipt.releasedAt = now;
        }
      }
      for (const discovery of input.discoveries) {
        const binding = state.bindings.find(
          (candidate) => candidate.bindingId === discovery.authorityId
        );
        if (!binding) throw conflict("ambient discovery 找不到 projection binding");
        const projection = this.validateProjectionDiscovery(binding, discovery, input);
        const exists = state.sessionDiscoveries.some(
          (receipt) =>
            receipt.releasedAt === null &&
            receipt.conversationId === input.conversationId &&
            receipt.backend === input.session.backend &&
            receipt.sessionId === input.session.id &&
            receipt.bindingId === discovery.authorityId
        );
        if (exists) continue;
        state.sessionDiscoveries.push({
          kind: "ambient-projection",
          receiptId: randomUUID(),
          conversationId: input.conversationId,
          backend: input.session.backend,
          backendRuntimeIdentity: input.backendRuntimeIdentity,
          sessionId: input.session.id,
          workspaceKey: projection.workspaceKey,
          bindingId: discovery.authorityId,
          installIdentity: projection.installIdentity,
          packageGenerationRef: structuredClone(discovery.packageGenerationRef),
          componentInstanceIdentity: discovery.componentInstanceIdentity,
          deliveryIdentity: discovery.deliveryIdentity,
          acquiredAt: now,
          releasedAt: null,
          revokedByOperationId: null,
        });
      }
      state.sessionDiscoveries = state.sessionDiscoveries.filter(
        (receipt) => receipt.releasedAt === null
      );
      return state.sessionDiscoveries.filter(
        (receipt) =>
          receipt.conversationId === input.conversationId &&
          receipt.backend === input.session.backend &&
          receipt.sessionId === input.session.id &&
          receipt.releasedAt === null
      );
    });
  }

  releaseSessionDiscovery(
    conversationId: string,
    session?: { backend: string; id: string },
    now = Date.now()
  ) {
    return this.file.mutate((state) => {
      for (const receipt of state.sessionDiscoveries) {
        if (
          receipt.conversationId === conversationId &&
          receipt.releasedAt === null &&
          (!session ||
            (receipt.backend === session.backend &&
              receipt.sessionId === session.id))
        ) {
          receipt.releasedAt = now;
        }
      }
      state.sessionDiscoveries = state.sessionDiscoveries.filter(
        (receipt) => receipt.releasedAt === null
      );
    });
  }

  sessionsAffected(operationId: string) {
    const state = this.file.snapshot();
    const sessions = new Map<string, {
      conversationId: string;
      backend: "codex" | "claude" | "kimi" | "opencode";
      sessionId: string;
    }>();
    for (const receipt of state.sessionDiscoveries) {
      if (
        receipt.releasedAt !== null ||
        receipt.revokedByOperationId !== operationId
      ) continue;
      const key = `${receipt.conversationId}\0${receipt.backend}\0${receipt.sessionId}`;
      sessions.set(key, {
        conversationId: receipt.conversationId,
        backend: receipt.backend,
        sessionId: receipt.sessionId,
      });
    }
    return [...sessions.values()];
  }

  installIdentityOfGeneration(ref: ExtensionPackageGenerationRef) {
    return this.registry.generationProjection(ref)?.installIdentity ?? null;
  }

  /**
   * 单 binding release：只撤一个 owner 在这一条目标上的存在理由，不再按
   * owner×workspace 整批退出。remove authority 在同一 mutate 内先消费，
   * 即使随后物理收敛失败也不能重放同一份授权。
   */
  releaseBinding(input: {
    bindingId: string;
    owner: ExtensionProjectionOwner;
    agent: ExtensionBindingAuthority["agent"];
    authorityToken: string;
    operationId: string;
  }, now = Date.now()) {
    return this.file.mutate((state) => {
      const binding = requireBinding(state.bindings, input.bindingId);
      this.consumeAuthority(state, {
        authorityToken: input.authorityToken,
        agent: input.agent,
        component: binding.componentInstanceIdentity,
        target: binding.targetPath,
        digest: binding.artifactDigest,
        action: "remove",
      }, now);
      binding.owners = binding.owners.filter((owner) => !sameOwner(owner, input.owner));
      if (!binding.owners.length && binding.state === "active") {
        binding.state = "revoke-pending";
        binding.revokedByOperationId = input.operationId;
      }
      return structuredClone(binding);
    });
  }

  releaseLease(bindingId: string, leaseId: string) {
    return this.file.mutate((state) => {
      const binding = requireBinding(state.bindings, bindingId);
      binding.leases = binding.leases.filter((item) => item.leaseId !== leaseId);
      return binding.leases.length;
    });
  }

  /** deny/卸载已提交：该包全部 binding 立刻停止签发新 lease，等 drain。 */
  beginRevoke(installIdentity: string, operationId: string) {
    return this.file.mutate((state) => {
      const affected = state.bindings.filter(
        (item) => item.installIdentity === installIdentity && item.state === "active"
      );
      for (const binding of affected) {
        binding.state = "revoke-pending";
        binding.revokedByOperationId = operationId;
      }
      for (const receipt of state.sessionDiscoveries) {
        if (
          receipt.installIdentity === installIdentity &&
          receipt.releasedAt === null
        ) {
          receipt.revokedByOperationId = operationId;
        }
      }
      return structuredClone(affected);
    });
  }

  private validateProjectionDiscovery(
    binding: ExtensionProjectionBinding,
    discovery: {
      kind: "ambient-projection";
      authorityId: string;
      packageGenerationRef: ExtensionPackageGenerationRef;
      componentInstanceIdentity: string;
      deliveryIdentity: Sha256Digest;
    },
    input: {
      session: { backend: "codex" | "claude" | "kimi" | "opencode" };
      backendRuntimeIdentity: string;
      projectContext: TurnProjectContext;
    }
  ) {
    const owner = this.registry.generationProjection(
      discovery.packageGenerationRef
    );
    const scopeMatches = owner?.scope.kind === "global" ||
      (owner?.scope.kind === "project" &&
        owner.scope.projectId === input.projectContext.projectId);
    if (
      binding.state !== "active" ||
      binding.delivery.backend !== input.session.backend ||
      binding.delivery.runtimeIdentity !== input.backendRuntimeIdentity ||
      binding.delivery.deliveryIdentity !== discovery.deliveryIdentity ||
      binding.componentInstanceIdentity !== discovery.componentInstanceIdentity ||
      binding.packageGenerationRef.packageGenerationId !==
        discovery.packageGenerationRef.packageGenerationId ||
      binding.packageGenerationRef.recordDigest !==
        discovery.packageGenerationRef.recordDigest ||
      !scopeMatches
    ) {
      throw conflict("session discovery 与 exact materialized binding 不一致");
    }
    return { installIdentity: binding.installIdentity, workspaceKey: binding.workspaceKey };
  }

  /**
   * 撤销落定。`foreign` 是「目标位置的字节不是产品写的那份」——产品无权删它，
   * 也无权声称已撤销，只能如实登记并交回用户手动处置。
   */
  settleRevoke(bindingId: string, outcome: "revoked" | "foreign") {
    return this.file.mutate((state) => {
      const binding = requireBinding(state.bindings, bindingId);
      if (binding.leases.length) {
        throw conflict("binding 仍有未归还的 lease");
      }
      if (
        state.sessionDiscoveries.some(
          (receipt) =>
            receipt.bindingId === bindingId && receipt.releasedAt === null
        )
      ) {
        throw conflict("binding 仍被 backend session discovery 持有");
      }
      binding.state = outcome;
      binding.owners = [];
      return structuredClone(binding);
    });
  }

  bindingsOf(installIdentity: string) {
    return this.file
      .snapshot()
      .bindings.filter((item) => item.installIdentity === installIdentity);
  }

  /** 本次收敛拽下来的、还没撤干净的 binding；按操作而不是按包收窄。 */
  pendingRevocations(operationId: string) {
    return this.file
      .snapshot()
      .bindings.filter(
        (item) =>
          item.state === "revoke-pending" &&
          item.revokedByOperationId === operationId
      );
  }

  settledRevocations(operationId: string) {
    return this.file
      .snapshot()
      .bindings.filter(
        (item) =>
          item.state === "revoked" && item.revokedByOperationId === operationId
      );
  }

  foreignOccupancies(installIdentity: string) {
    return this.bindingsOf(installIdentity).filter(
      (item) => item.state === "foreign"
    );
  }

  /** 仍持有引用的 binding 与未归还的 lease：卸载的运行期闸门读这两个数。 */
  outstanding(installIdentity: string) {
    const holding = this.bindingsOf(installIdentity).filter((item) =>
      HOLDING.includes(item.state)
    );
    return {
      bindings: holding.map((item) => item.bindingId),
      leases: holding.flatMap((item) => item.leases.map((lease) => lease.leaseId)),
      sharedArtifacts: this.bindingsOf(installIdentity).filter(
        (item) =>
          item.state === "revoked" &&
          this.artifactHolders(item.artifactDigest).length > 0
      ).length,
    };
  }

  /**
   * 共享产物是否还有人用——**跨 package** 数，不是只数自己那几条。
   * 一轮 cleanup 回收另一轮仍在用的产物，正是 refcount 存在的唯一理由。
   */
  artifactHolders(artifactDigest: Sha256Digest) {
    return this.file
      .snapshot()
      .bindings.filter(
        (item) =>
          item.artifactDigest === artifactDigest && HOLDING.includes(item.state)
      )
      .map((item) => item.bindingId);
  }

  /**
   * 受影响的 workspace：只有它们里的产品会话可能持有旧 discovery snapshot。
   *
   * 按**本次收敛**拽下来的 binding 算，而不是「当前还没撤干净的」——撤销先于
   * drain 发生，用后者会让受影响面在正确执行顺序下恰好塌成空集。
   */
  affectedWorkspaces(operationId: string) {
    return [
      ...new Set(
        this.file
          .snapshot()
          .bindings.filter((item) => item.revokedByOperationId === operationId)
          .map((item) => item.workspaceKey)
      ),
    ].sort();
  }

  snapshot() {
    return this.file.snapshot().bindings;
  }

  /* 新 binding 同时读取 Registry 行政/removal 真相与独立 projection admission。
     `$` catalog enable 故意不在此处：候选展示与写 HOME 是两份授权。 */
  private assertPackageAdmits(
    state: ProjectionLedgerState,
    input: AcquireProjectionInput
  ) {
    const owner = this.registry.packageInventory(input.installIdentity);
    if (owner?.administrativeState !== "active") {
      throw conflict("package 已提交停用，不接受新的 projection binding");
    }
    const admitted = state.projectionAdmissions.some((item) =>
      item.installIdentity === input.installIdentity &&
      item.packageGenerationRef.packageGenerationId === input.packageGenerationRef.packageGenerationId &&
      item.packageGenerationRef.recordDigest === input.packageGenerationRef.recordDigest &&
      item.componentInstanceIdentity === input.componentInstanceIdentity
      && item.delivery.backend === input.delivery.backend
      && item.delivery.transport === input.delivery.transport
      && item.delivery.runtimeIdentity === input.delivery.runtimeIdentity
      && item.delivery.deliveryIdentity === input.delivery.deliveryIdentity
    );
    if (!admitted) {
      throw conflict("component 尚未获得独立 projection admission");
    }
    if (
      owner.removalPendingGenerationIds.includes(
        input.packageGenerationRef.packageGenerationId
      )
    ) {
      throw conflict("package generation 正在卸载，不接受新的 projection binding");
    }
  }

  private consumeAuthority(
    state: ProjectionLedgerState,
    expected: Omit<ExtensionBindingAuthority, "expiresAt" | "consumedAt">,
    now: number
  ) {
    const authority = state.authorities.find(
      (item) => item.authorityToken === expected.authorityToken
    );
    if (!authority || authority.consumedAt !== null || authority.expiresAt <= now) {
      throw conflict("projection authority 已失效");
    }
    for (const key of ["agent", "component", "target", "digest", "action"] as const) {
      if (authority[key] !== expected[key]) {
        throw conflict(`projection authority 与 ${key} 不匹配`);
      }
    }
    authority.consumedAt = now;
  }

  private joinOrCreate(
    bindings: ExtensionProjectionBinding[],
    input: AcquireProjectionInput
  ) {
    const existing = bindings.find(
      (item) =>
        item.projectionId === input.projectionId && HOLDING.includes(item.state)
    );
    if (existing) {
      if (existing.state !== "active") {
        throw conflict("已进入撤销的 projection binding 不再签发 lease");
      }
      /* 同一目标、同一份字节 = 共享；内容不同才是同名冲突，必须显式解决。 */
      if (
        existing.artifactDigest !== input.artifactDigest ||
        existing.componentInstanceIdentity !== input.componentInstanceIdentity ||
        existing.delivery.deliveryIdentity !== input.delivery.deliveryIdentity
      ) {
        throw conflict("同一投影目标已被占用");
      }
      if (!existing.owners.some((item) => sameOwner(item, input.owner))) {
        existing.owners.push(structuredClone(input.owner) as ExtensionProjectionOwner);
      }
      return existing;
    }
    const { owner, ...rest } = structuredClone(input) as AcquireProjectionInput;
    const binding: ExtensionProjectionBinding = {
      ...rest,
      bindingId: randomUUID(),
      owners: [owner],
      leases: [],
      state: "active",
      revokedByOperationId: null,
    };
    bindings.push(binding);
    return binding;
  }
}

function sameOwner(
  left: ExtensionProjectionOwner,
  right: ExtensionProjectionOwner
) {
  return left.kind === "app" && right.kind === "app"
    ? left.appId === right.appId
    : left.kind === right.kind;
}

function requireBinding(
  bindings: ExtensionProjectionBinding[],
  bindingId: string
) {
  const binding = bindings.find((item) => item.bindingId === bindingId);
  if (!binding) throw new Error("projection binding 不存在");
  return binding;
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}
