/**
 * [INPUT]: Depends on the recipe contract.
 * [OUTPUT]: Provides PLAN_DEVELOP_REVIEW, the one recipe this release ships (read → plan → save-plan → confirm-plan → begin-development → implement → save-implementation → review → save-review → confirm-result → close-record), checked at load.
 * [POS]: The Workflow plugin's built-in recipe as data; rework runs start at begin-development and carry the accepted plan. Stage ids are stable; the interface names them.
 */
import { checkRecipe, type WorkflowRecipe } from "./recipe";

const from = ($from: string) => ({ $from });
const recipe = {
  schema: "bottega.workflow.recipe/v1", recipeId: "bottega.plan-develop-review", version: 1, name: "Plan · Develop · Review",
  inputs: { task: "text", acceptanceCriteria: "text" },
  bindingSlots: { taskName: "text", stage: "workflow-stage", acceptanceCriteria: "workflow-acceptance-criteria" },
  stages: [{ id: "plan" }, { id: "develop" }, { id: "review" }, { id: "done" }],
  steps: [
    { id: "read", label: "Read the record", kind: "app.call", action: "base.read", required: true, inputs: {} },
    { id: "plan", label: "Plan", kind: "agent.run", role: "plan", required: true,
      inputs: { task: from("steps.read.output.task"), acceptanceCriteria: from("steps.read.output.acceptanceCriteria") } },
    { id: "save-plan", label: "Save the plan summary", kind: "app.call", action: "base.write-summary", required: true,
      inputs: { summary: from("steps.plan.output.result"), slot: "plan" } },
    { id: "confirm-plan", label: "Confirm the plan", kind: "human.confirm", confirmation: "plan", required: true,
      inputs: { proposal: from("steps.plan.output.result") } },
    { id: "begin-development", label: "Move to Develop", kind: "app.call", action: "base.set-stage", required: true, inputs: { stage: "develop" } },
    { id: "implement", label: "Develop", kind: "agent.run", role: "develop", required: true,
      inputs: { task: from("steps.read.output.task"), acceptanceCriteria: from("steps.read.output.acceptanceCriteria"), plan: from("steps.plan.output.result") } },
    { id: "save-implementation", label: "Save the implementation summary", kind: "app.call", action: "base.write-summary", required: true,
      inputs: { summary: from("steps.implement.output.result"), slot: "implementation" } },
    { id: "review", label: "Review", kind: "agent.run", role: "review", required: true,
      inputs: { task: from("steps.read.output.task"), acceptanceCriteria: from("steps.read.output.acceptanceCriteria"), plan: from("steps.plan.output.result"),
        implementation: from("steps.implement.output.result") } },
    { id: "save-review", label: "Save the review summary", kind: "app.call", action: "base.write-summary", required: true,
      inputs: { summary: from("steps.review.output.result"), slot: "review" } },
    { id: "confirm-result", label: "Accept the result", kind: "human.confirm", confirmation: "result", required: true,
      inputs: { proposal: from("steps.review.output.result") } },
    { id: "close-record", label: "Move to Done", kind: "app.call", action: "base.set-stage", required: true, inputs: { stage: "done" } },
  ],
  reworkFrom: "begin-development",
};
const checked = checkRecipe(recipe);
if (!checked.ok) throw new Error(`built-in recipe is invalid: ${JSON.stringify(checked.issues)}`);
export const PLAN_DEVELOP_REVIEW: WorkflowRecipe = Object.freeze(checked.recipe);
