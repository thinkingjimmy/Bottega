/**
 * [INPUT]: Depends on the BaseColumn model.
 * [OUTPUT]: Provides the workflow-column rule shared by every writer: effectiveWritableBy, isWorkflowOnly, the first column a non-workflow write may not change, the schema-edit rule (workflowSchemaViolation), the `column_workflow_only` issue code, and workflowColumnsOf (the two columns by role).
 * [POS]: Base compute (Q12/Q36/Q37): desktop store writers and Cloud Web edits ask the same function, and columns are identified by marker and id, never by their (translatable) names.
 */
import type { BaseColumn } from "../model/base-values";

export const WORKFLOW_ONLY_ISSUE = "column_workflow_only";
/** Absent means the role's default: a workflow writes Stage, people write the Acceptance criteria. */
export const effectiveWritableBy = (column: BaseColumn) =>
  column.workflow ? column.writableBy ?? (column.workflow.role === "stage" ? "workflows" : "everyone") : "everyone";
export const isWorkflowOnly = (column: BaseColumn) => effectiveWritableBy(column) === "workflows";

/**
 * The first changed column this writer may not change, or null. `workflow` is a verified workflow run; everyone else —
 * a person, a Chat Agent, another port writer, an import — is `other`. Sync replays already-accepted operations and does
 * not ask.
 */
export function workflowOnlyViolation(columns: ReadonlyMap<string, BaseColumn>, changedColumnIds: Iterable<string>, writer: "workflow" | "other") {
  if (writer === "workflow") return null;
  for (const columnId of changedColumnIds) {
    const column = columns.get(columnId);
    if (column && isWorkflowOnly(column)) return column;
  }
  return null;
}

export function workflowColumnsOf(columns: readonly BaseColumn[]) {
  return { stage: columns.find(column => column.workflow?.role === "stage") ?? null,
    acceptanceCriteria: columns.find(column => column.workflow?.role === "acceptance-criteria") ?? null };
}

/**
 * Schema edits around the two workflow columns: only a workflow (or the host itself) adds, removes or changes the
 * `workflow` marker; a person may change who can edit them and may delete them (the binding is then suspended); a Chat
 * Agent or an App may do neither. Returns the refused column, or null.
 */
export function workflowSchemaViolation(before: readonly BaseColumn[], after: readonly BaseColumn[], writer: "workflow" | "person" | "program") {
  if (writer === "workflow") return null;
  const previous = new Map(before.map(column => [column.id, column]));
  for (const column of after) {
    const old = previous.get(column.id);
    if (JSON.stringify(old?.workflow ?? null) !== JSON.stringify(column.workflow ?? null)) return column;
    if (writer === "program" && old && (old.writableBy ?? null) !== (column.writableBy ?? null)) return column;
  }
  if (writer === "program") for (const column of before) if (column.workflow && !after.some(item => item.id === column.id)) return column;
  return null;
}
