/**
 * [INPUT]: Depends on BaseStore snapshots, BaseOwnerResolver's owner identity and mutation checks, BaseCommitAuthorityRegistry, the App surface validator the App runtime configures, the run owner's VerifiedPrincipal, and the shared statusError constructor from main/errors
 * [OUTPUT]: Provides BaseMutationAuthority: the one rule that a Base must already exist (ownerSnapshot/requireOwner), the Tool, system, workflow and renderer issuers with their scope checks and error codes, and the identity/scope assertions every write runs before committing; BaseAppSurfaceValidator
 * [POS]: Write-permission policy of bases, held by BasesService; the registry mints and checks capabilities, this decides who may get one
 */
import type { BaseStore } from "./base-store";
import type { BaseLeaseIdentity, BaseOwnerResolver } from "./service/base-owner-resolver";
import type { BaseCommitAuthority, BaseCommitAuthorityRegistry, BaseMutationOperation } from "./service/base-commit-authority";
import { statusError } from "../ipc/errors";
import type { VerifiedPrincipal } from "../operations/principals";

export type BaseAppSurfaceValidator = {
  validateMutation(input: {
    surfaceLeaseId: string;
    ownerKey: string;
    operation: BaseMutationOperation;
  }): Promise<unknown>;
};

export class BaseMutationAuthority {
  private surfaceValidator: BaseAppSurfaceValidator | null = null;
  constructor(
    private readonly store: BaseStore,
    private readonly ownerResolver: BaseOwnerResolver,
    private readonly registry: BaseCommitAuthorityRegistry
  ) {}

  configureSurfaceValidator(validator: BaseAppSurfaceValidator) {
    if (this.surfaceValidator) throw new Error("Base App surface validator 已配置");
    this.surfaceValidator = validator;
  }

  async forTool(input: {
    ownerKey: string;
    lease: BaseLeaseIdentity;
    operation: BaseMutationOperation;
    appId?: string;
  }) {
    const identity = await this.ownerResolver.identityForOwnerKey(input.ownerKey);
    const snapshot = this.store.get(
      input.ownerKey,
      identity.ownerInstanceId || undefined
    );
    if (!snapshot) throw statusError(404, "Base 尚未创建", { code: "base_not_found" });
    const principal = await this.ownerResolver.assertCanMutate(
      snapshot.meta,
      input.lease,
      input.appId
    );
    if (
      principal.kind === "app-attachment" &&
      (principal.level !== "row-write" || input.operation === "meta")
    ) {
      throw statusError(403, "App attachment 只允许 ordinary Base 行级 mutation");
    }
    return this.registry.issueAgent({
      ownerKey: input.ownerKey,
      ownerInstanceId: snapshot.meta.ownerInstanceId,
      allowedOperations: [input.operation],
      expectedRevision: snapshot.meta.revision,
      ...(principal.kind === "app-attachment"
        ? {
            appFence: {
              appId: principal.appId,
              generationId: principal.snapshot.appGenerationId,
              contentDigest: principal.snapshot.appContentDigest,
              lifecycleRevision: principal.snapshot.appLifecycleRevision,
            },
          }
        : {}),
    });
  }

  async forSystem(
    ownerKey: string,
    operation: BaseMutationOperation
  ) {
    const snapshot = await this.requireOwner(ownerKey);
    return this.registry.issueSystem({
      ownerKey,
      ownerInstanceId: snapshot.meta.ownerInstanceId,
      allowedOperations: [operation],
      expectedRevision: snapshot.meta.revision,
    });
  }

  /**
   * A verified workflow run's authority: the only one that may change a workflow-only column (Q12). Its evidence is the run
   * owner's live `workflow-run` principal; any other kind, or one whose attempt has ended, is refused.
   */
  async forWorkflow(ownerKey: string, operation: BaseMutationOperation, principal: VerifiedPrincipal) {
    if (principal.principal.kind !== "workflow-run") throw statusError(403, "workflow authority requires a workflow-run principal");
    principal.assertCurrent();
    const snapshot = await this.requireOwner(ownerKey);
    return this.registry.issueWorkflow({ ownerKey, ownerInstanceId: snapshot.meta.ownerInstanceId,
      allowedOperations: [operation], expectedRevision: null }, principal.principal.runId);
  }

  /**
   * renderer 的写入资格：owner 快照 + App surface 校验，没有第二次 IPC。
   * revision 不在这里预判——owner queue 里的内核 CAS 是唯一裁判，
   * 这里再判一次只会制造一个「判过又反悔」的 TOCTOU 窗口。
   */
  async forRenderer(input: {
    ownerKey: string;
    operation: BaseMutationOperation;
    expectedRevision: number | null;
    surfaceLeaseId?: string;
  }) {
    const { snapshot } = await this.ownerSnapshot(input.ownerKey);
    if (input.surfaceLeaseId) {
      if (!this.surfaceValidator) {
        throw statusError(503, "App surface authority 尚未初始化");
      }
      await this.surfaceValidator.validateMutation({
        surfaceLeaseId: input.surfaceLeaseId,
        ownerKey: input.ownerKey,
        operation: input.operation,
      });
    }
    return this.registry.issueRenderer({
      ownerKey: input.ownerKey,
      ownerInstanceId: snapshot.meta.ownerInstanceId,
      allowedOperations: [input.operation],
      expectedRevision: input.expectedRevision,
    });
  }

  /** owner 解析 + 「Base 必须已存在」的唯一一份规则；三个写入前置都从这里取事实。 */
  async ownerSnapshot(ownerKey: string) {
    const identity = await this.ownerResolver.identityForOwnerKey(ownerKey);
    const snapshot = this.store.get(
      ownerKey,
      identity.ownerInstanceId || undefined
    );
    if (!snapshot) throw statusError(404, "Base 尚未创建", { code: "base_not_found" });
    return { identity, snapshot };
  }

  async requireOwner(ownerKey: string) {
    return (await this.ownerSnapshot(ownerKey)).snapshot;
  }

  async identity(
    ownerKey: string,
    authority: BaseCommitAuthority,
    operation: BaseMutationOperation
  ) {
    const { identity, snapshot } = await this.ownerSnapshot(ownerKey);
    this.registry.assert(authority, {
      ownerKey,
      ownerInstanceId: snapshot.meta.ownerInstanceId,
      operation,
      revision: snapshot.meta.revision,
    });
    return identity;
  }

  async scope(
    ownerKey: string,
    authority: BaseCommitAuthority,
    operation: BaseMutationOperation,
    appFence: NonNullable<BaseCommitAuthority["appFence"]>
  ) {
    const { identity, snapshot } = await this.ownerSnapshot(ownerKey);
    this.registry.assertScope(authority, {
      ownerKey,
      ownerInstanceId: snapshot.meta.ownerInstanceId,
      operation,
      appFence,
    });
    return identity;
  }
}
