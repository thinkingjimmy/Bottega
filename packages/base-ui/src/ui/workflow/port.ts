/**
 * [INPUT]: Depends on @ai-chat/base-core semantic contracts and the Base meta contract and its column / view limits and on the shared workflow-column rule; its recipe shape
 *          is the part of `bottega.workflow.recipe/v1` the dialog reads, which the cloud-protocol WorkflowRecipe satisfies
 *          structurally (base-ui does not depend on cloud-protocol).
 * [OUTPUT]: Provides WorkflowSetupPort — what the setup dialog asks its host — plus WorkflowStepView and displaySteps, the
 *           five steps a person reads (Plan, Confirm, Develop, Review, Decide) derived from a recipe's steps, and
 *           WorkflowBaseShape / workflowBaseShape / baseHasRoom, what turning the workflow on does to the Base (BAS-06, U02 · 3).
 * [POS]: The host boundary of ui/workflow: desktop, Cloud Web and the phone each implement the port; the dialog never reads
 *        IPC, Agent configs or computers itself.
 */
import { workflowColumnsOf } from "@ai-chat/base-core/compute/workflow-columns";
import { BASE_COLUMN_LIMIT, BASE_VIEW_LIMIT, type BaseMeta } from "@ai-chat/base-core/model/bases-ipc";

export type WorkflowRoleName = "plan" | "develop" | "review";
export type WorkflowRecipeView = {
  recipeId: string;
  version: number;
  name: string;
  /** Where keeping an accepted plan starts a rework run (06 §6). */
  reworkFrom: string;
  steps: readonly ({ id: string; kind: "agent.run"; role: WorkflowRoleName } | { id: string; kind: "human.confirm"; confirmation: "plan" | "result" }
    | { id: string; kind: "app.call" })[];
};

export type WorkflowStepView =
  | { key: string; kind: "agent"; role: WorkflowRoleName }
  | { key: string; kind: "confirm-plan" | "decide" };

/** app.call steps (read, save a summary, move the Stage) are the workflow's own bookkeeping and are not shown. */
export function displaySteps(recipe: Pick<WorkflowRecipeView, "steps">): WorkflowStepView[] {
  return recipe.steps.flatMap((step): WorkflowStepView[] => step.kind === "agent.run" ? [{ key: step.id, kind: "agent", role: step.role }]
    : step.kind === "human.confirm" ? [{ key: step.id, kind: step.confirmation === "plan" ? "confirm-plan" : "decide" }] : []);
}

export type RoleCandidate = { configId: string; name: string; provider: string; available: boolean; reason: string | null };
export type SetupCheck = { label: string; ok: boolean };
export type WorkflowSetupInput = {
  bindingId: string | null;
  recipe: { recipeId: string; version: number };
  roles: Record<WorkflowRoleName, { configId: string }>;
  /** Named in the interface language when the workflow is turned on; the kernel knows the columns by id. */
  columnNames: { stage: string; acceptanceCriteria: string; boardView: string };
};
export type WorkflowSetupPort = {
  recipes(): Promise<readonly WorkflowRecipeView[]>;
  /** Configurations offered in this Project for a role; the ones that cannot fill it come back unavailable with a reason. */
  candidates(role: WorkflowRoleName): Promise<readonly RoleCandidate[]>;
  /** Readiness on the Project's computer; while it is offline nothing can be turned on (Q25). */
  check(input: WorkflowSetupInput): Promise<{ computer: string; online: boolean; items: readonly SetupCheck[] }>;
  save(input: WorkflowSetupInput): Promise<void>;
};

/**
 * What turning the workflow on does to the Base, read from its live meta. The board follows the kernel's rule: it comes only
 * with a new Stage column and a free view slot. `structureKey` names the columns and the view count, never the revision, so a
 * cell edit is not a change of structure (Q13).
 */
export type WorkflowBaseShape = { columnNames: readonly string[]; columnCount: number; columnLimit: number;
  /** The workflow columns the Base does not have yet: what turning on adds. */
  missing: readonly ("stage" | "acceptance-criteria")[]; columnsNeeded: number;
  board: "added" | "none" | "views-full"; viewLimit: number; structureKey: string };
export function workflowBaseShape(meta: Pick<BaseMeta, "columns" | "views">): WorkflowBaseShape {
  const present = workflowColumnsOf(meta.columns);
  return { columnNames: meta.columns.map(column => column.name), columnCount: meta.columns.length,
    missing: [...(present.stage ? [] : ["stage" as const]), ...(present.acceptanceCriteria ? [] : ["acceptance-criteria" as const])],
    columnsNeeded: Number(!present.stage) + Number(!present.acceptanceCriteria), columnLimit: BASE_COLUMN_LIMIT,
    board: present.stage ? "none" : meta.views.length < BASE_VIEW_LIMIT ? "added" : "views-full", viewLimit: BASE_VIEW_LIMIT,
    structureKey: JSON.stringify([meta.columns.map(column => [column.id, column.name]), meta.views.length]) };
}
export const baseHasRoom = (shape: WorkflowBaseShape) => shape.columnCount + shape.columnsNeeded <= shape.columnLimit;
