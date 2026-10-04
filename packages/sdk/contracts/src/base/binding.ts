/**
 * [INPUT]: Depends on Zod and the BaseRef resource contract
 * [OUTPUT]: Provides baseBindingSchema (a Base, its task-name column and the workflow's Stage and Acceptance criteria columns, all by id) and resolveBinding, which says whether the Base part of a workflow binding is active or suspended, and why
 * [POS]: Pure binding semantics shared by the host, the Workflow plugin and the SDK: no field mapping, no option mapping; columns are followed by id and recognised by their workflow marker, never by (translatable) names
 */
import { z } from "zod";
import { baseRefSchema, type BaseRef } from "../model/resources";

const id = z.string().min(1).max(128);
/* The Base part of a binding: the task each record names, and the two columns the workflow added. The rest of a
   binding — each step's Agent configuration and the Project's computer — belongs to the Workflow binding itself. */
export const baseBindingSchema = z.object({
  base: baseRefSchema,
  taskNameColumnId: id,
  stageColumnId: id,
  acceptanceCriteriaColumnId: id,
}).strict();
export type BaseBinding = z.infer<typeof baseBindingSchema>;

type Column = Readonly<{ id: string; type: string; workflow?: { role: string } }>;
export const BINDING_REASONS = ["instance-changed", "task-name-missing", "stage-missing", "acceptance-criteria-missing"] as const;
export type BindingReason = (typeof BINDING_REASONS)[number];

/** Suspended when the Base instance changed or a bound column is gone, changed type or lost its workflow marker. */
export function resolveBinding(binding: BaseBinding, current: { ref: BaseRef; columns: readonly Column[] }) {
  if (current.ref.ownerKey !== binding.base.ownerKey || current.ref.ownerInstanceId !== binding.base.ownerInstanceId) {
    return { state: "suspended" as const, reasons: ["instance-changed" as BindingReason] };
  }
  const columns = new Map(current.columns.map(column => [column.id, column]));
  const task = columns.get(binding.taskNameColumnId), stage = columns.get(binding.stageColumnId);
  const criteria = columns.get(binding.acceptanceCriteriaColumnId);
  const reasons: BindingReason[] = [
    ...(task?.type === "text" ? [] : ["task-name-missing" as const]),
    ...(stage?.type === "select" && stage.workflow?.role === "stage" ? [] : ["stage-missing" as const]),
    ...(criteria?.type === "text" && criteria.workflow?.role === "acceptance-criteria" ? [] : ["acceptance-criteria-missing" as const]),
  ];
  return reasons.length ? { state: "suspended" as const, reasons } : { state: "active" as const, reasons };
}
