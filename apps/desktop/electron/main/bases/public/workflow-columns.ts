/**
 * [INPUT]: Depends on @ai-chat/base-core semantic contracts and BasesService (read, system authority, meta update), the shared workflow-column rule, the column and view limits and renumberViews.
 * [OUTPUT]: Provides enableWorkflowColumns: adds a workflow's Stage (select, workflows-only) and Acceptance criteria (text, everyone) columns once, named by the caller in the interface language, with the "Board · by Stage" view made active, and answers the column ids.
 * [POS]: The one way the two workflow columns come into being (TASK-17 calls it when a workflow is turned on); everything afterwards finds them by marker and id, never by name.
 */
import { randomUUID } from "node:crypto";
import { workflowColumnsOf } from "@ai-chat/base-core/compute/workflow-columns";
import { BASE_COLUMN_LIMIT, BASE_VIEW_LIMIT, type BaseColumn, type BaseMetaPatch, type BaseSelectOption } from "../../../../shared/bases/model/bases-ipc";
import { renumberViews } from "../../../../shared/bases/model/base-views";
import { statusError } from "../../ipc/errors";
import type { BasesService } from "../bases-service";

export type WorkflowColumnNames = { stage: string; acceptanceCriteria: string; boardView: string };
/**
 * Idempotent: a Base that already has the two columns answers their ids (even after they were renamed). A Base without
 * room for what is missing is refused whole (`base-column-limit`), never given one column of two.
 * The board grouped by Stage comes in the same patch as a new Stage column and becomes the active view. It is never added
 * again for an existing Stage column, so a board the person deleted stays deleted; a Base with no room for another view
 * still turns the workflow on, without the board.
 */
export async function enableWorkflowColumns(service: Pick<BasesService, "get" | "issueSystemMutationAuthority" | "updateMeta">, ownerKey: string,
  names: WorkflowColumnNames, stageOptions: BaseSelectOption[] = []) {
  const current = await service.get(ownerKey);
  if (!current) throw statusError(404, "Base 不存在", { code: "base-not-found" });
  const existing = workflowColumnsOf(current.meta.columns);
  if (existing.stage && existing.acceptanceCriteria) return { stageColumnId: existing.stage.id, acceptanceCriteriaColumnId: existing.acceptanceCriteria.id };
  const stageId = existing.stage?.id ?? `stage-${randomUUID().slice(0, 8)}`;
  const added: BaseColumn[] = [
    ...(existing.stage ? [] : [{ id: stageId, name: names.stage, type: "select" as const, options: stageOptions,
      workflow: { role: "stage" as const } }]),
    ...(existing.acceptanceCriteria ? [] : [{ id: `acceptance-${randomUUID().slice(0, 8)}`, name: names.acceptanceCriteria, type: "text" as const,
      workflow: { role: "acceptance-criteria" as const } }]),
  ];
  if (current.meta.columns.length + added.length > BASE_COLUMN_LIMIT) {
    throw statusError(409, `开启流程需要 ${added.length} 列，这个 Base 已有 ${current.meta.columns.length} 列（上限 ${BASE_COLUMN_LIMIT}）`, { code: "base-column-limit" });
  }
  const patch: BaseMetaPatch = { columns: [...current.meta.columns, ...added] };
  if (!existing.stage && current.meta.views.length < BASE_VIEW_LIMIT) {
    const board = { id: `view-${randomUUID().slice(0, 8)}`, name: names.boardView, order: current.meta.views.length,
      config: { type: "kanban" as const, groupByColumnId: stageId } };
    Object.assign(patch, { views: renumberViews([...current.meta.views, board]), activeViewId: board.id });
  }
  const authority = await service.issueSystemMutationAuthority(ownerKey, "meta");
  const next = await service.updateMeta({ ownerKey, expectedRevision: current.meta.revision, authority, patch });
  const columns = workflowColumnsOf(next.meta.columns);
  return { stageColumnId: columns.stage!.id, acceptanceCriteriaColumnId: columns.acceptanceCriteria!.id };
}
