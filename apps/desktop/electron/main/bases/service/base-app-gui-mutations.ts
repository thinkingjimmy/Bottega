/**
 * [INPUT]: Depends on BaseCommitAuthorityRegistry BaseRowMutations Only submit kernel BaseAttachmentService owner-scoped read with active GUI binding
 * [OUTPUT]: Provides BaseAppGuiMutations, binding capability to authenticate generation fence as insert/patch/delete authority, and read owner own attachments
 * [POS]: The bases/service App GUI authorization is adapted to the page; Not to copy CAS, validation, history or annex attribution rules
 */

import type {
  BaseGuiCapability,
  BaseGuiLiveBinding,
} from "../../../../shared/apps-ipc";
import type { BaseRow, BaseRowPatch, BaseSnapshot } from "../../../../shared/bases-ipc";
import type {
  BaseCommitAuthorityRegistry,
  BaseMutationOperation,
} from "../base-commit-authority";
import type { BaseAttachmentService } from "../attachment-service";
import type { BaseRowMutations } from "./base-row-mutations";

type Options = {
  requireOwner(ownerKey: string): Promise<BaseSnapshot>;
};

/* BaseMutationOperation 与 BaseGuiCapability 取名一致但类型分开（D-B1）。
   GUI 能驱动的恰好是两者的交集——写成 Extract 而不是手抄一份字面量：任一
   侧改值域，这里立刻编译失败，不会留下一张悄悄过期的映射表。 */
type GuiMutationOperation = Extract<BaseMutationOperation, BaseGuiCapability>;

export class BaseAppGuiMutations {
  constructor(
    private readonly rows: BaseRowMutations,
    private readonly attachments: BaseAttachmentService,
    private readonly authorities: BaseCommitAuthorityRegistry,
    private readonly options: Options
  ) {}

  async insert(input: {
    ownerKey: string;
    binding: BaseGuiLiveBinding;
    expectedBaseInstanceId: string;
    expectedRevision: number;
    rows: BaseRow[];
  }) {
    const { authority, appFence } = await this.authorize(
      input.ownerKey,
      input.binding,
      "row-insert"
    );
    const result = await this.rows.insertRowsReplayAware({
      ...input,
      authority,
      appFence,
    });
    return {
      baseInstanceId: result.snapshot.meta.ownerInstanceId,
      revision: result.snapshot.meta.revision,
      rowCount: result.snapshot.rows.length,
      rowIds: input.rows.map((row) => row.id),
      replayed: result.replayed,
    };
  }

  async patch(input: {
    ownerKey: string;
    binding: BaseGuiLiveBinding;
    expectedBaseInstanceId: string;
    expectedRevision: number;
    patches: Array<{ rowId: string; patch: BaseRowPatch }>;
  }) {
    const { authority, appFence } = await this.authorize(
      input.ownerKey,
      input.binding,
      "row-patch"
    );
    const result = await this.rows.patchRowsReplayAware({
      ...input,
      authority,
      appFence,
    });
    return {
      baseInstanceId: result.snapshot.meta.ownerInstanceId,
      revision: result.snapshot.meta.revision,
      rowCount: result.snapshot.rows.length,
      rowIds: result.rowIds,
      replayed: result.replayed,
    };
  }

  async delete(input: {
    ownerKey: string;
    binding: BaseGuiLiveBinding;
    expectedBaseInstanceId: string;
    expectedRevision: number;
    rowIds: string[];
  }) {
    const { authority, appFence } = await this.authorize(
      input.ownerKey,
      input.binding,
      "row-delete"
    );
    const result = await this.rows.deleteRowsReplayAware({
      ...input,
      authority,
      appFence,
    });
    return {
      baseInstanceId: result.snapshot.meta.ownerInstanceId,
      revision: result.snapshot.meta.revision,
      rowCount: result.snapshot.rows.length,
      removedRowIds: result.removedRowIds,
      missingRowIds: result.missingRowIds,
      replayed: result.replayed,
    };
  }

  async readAttachment(ownerKey: string, attachmentId: string) {
    await this.options.requireOwner(ownerKey);
    return this.attachments.readAttachmentForOwner(ownerKey, attachmentId);
  }

  /* 防御纵深：router 已按 effective capability 拦过一次，这里再按 binding
     自证一次。两处判据同源（binding.baseCapabilities），但适配叶不依赖调用
     方替它把门——将来多一个入口调 insert/patch/delete 也不会静默提权。 */
  private async authorize(
    ownerKey: string,
    binding: BaseGuiLiveBinding,
    operation: GuiMutationOperation
  ) {
    if (!binding.baseCapabilities.includes(operation)) {
      throw Object.assign(new Error(`缺少 ${operation} capability`), {
        status: 403,
        code: "capability_not_granted",
        outcome: "not-committed" as const,
      });
    }
    const snapshot = await this.options.requireOwner(ownerKey);
    const appFence = {
      appId: binding.appId,
      generationId: binding.generationId,
      contentDigest: binding.contentDigest,
      lifecycleRevision: binding.lifecycleRevision,
      capabilityDecisionId: binding.capabilityDecisionId,
      capabilityRevision: binding.capabilityRevision,
    } as const;
    return {
      appFence,
      authority: this.authorities.issueAppGui({
        ownerKey,
        ownerInstanceId: snapshot.meta.ownerInstanceId,
        allowedOperations: [operation],
        expectedRevision: null,
        appFence,
      }),
    };
  }
}
