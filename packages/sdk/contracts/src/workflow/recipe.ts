/**
 * [INPUT]: Depends on Zod.
 * [OUTPUT]: Provides the `bottega.workflow.recipe/v1` document (a versioned linear list of agent.run / app.call / human.confirm steps whose inputs are JSON constants or typed `$from` references), the output each step kind and action declares, and checkRecipe, the static check every recipe passes before it can bind.
 * [POS]: The recipe half of the workflow contracts. This release ships only the built-in Plan · Develop · Review recipe: no user or Agent drafting, validate, preview or enable flow; the recipe is still a versioned structure and a run freezes its version.
 */
import { z } from "zod";

export const WORKFLOW_RECIPE_SCHEMA = "bottega.workflow.recipe/v1";
export const WORKFLOW_ROLES = ["plan", "develop", "review"] as const;
export type WorkflowRoleName = (typeof WORKFLOW_ROLES)[number];
const stepId = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const name = z.string().regex(/^[a-z][a-zA-Z0-9]{0,47}$/);
/* A reference names an input or an earlier step's declared output; it is data, never an expression. */
export const refSchema = z.object({ $from: z.string().regex(/^(inputs\.[a-z][a-zA-Z0-9]{0,47}|steps\.[a-z][a-z0-9-]{0,47}\.output\.[a-z][a-zA-Z0-9]{0,47})$/) }).strict();
const argument = z.union([refSchema, z.string().max(4_096), z.number(), z.boolean(), z.null()]);
const args = z.record(name, argument).refine(value => Object.keys(value).length <= 16, "too-many-inputs");

/* Every step is required and the field stays so a reader can check it; there is no "failure counts as success". */
const common = { id: stepId, label: z.string().min(1).max(120), required: z.literal(true), inputs: args };
export const APP_ACTIONS = ["base.read", "base.write-summary", "base.set-stage"] as const;
export const recipeStepSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("agent.run"), role: z.enum(WORKFLOW_ROLES) }).strict(),
  z.object({ ...common, kind: z.literal("app.call"), action: z.enum(APP_ACTIONS) }).strict(),
  z.object({ ...common, kind: z.literal("human.confirm"), confirmation: z.enum(["plan", "result"]) }).strict(),
]);
export type RecipeStep = z.infer<typeof recipeStepSchema>;

export const workflowRecipeSchema = z.object({
  schema: z.literal(WORKFLOW_RECIPE_SCHEMA),
  recipeId: z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/),
  version: z.number().int().positive(),
  name: z.string().min(1).max(120),
  /** The run's own inputs, read from the bound record. */
  inputs: z.record(name, z.enum(["text"])),
  /** The Base part of a binding: only the task-name column and the two workflow columns; no field mapping. */
  bindingSlots: z.object({ taskName: z.literal("text"), stage: z.literal("workflow-stage"), acceptanceCriteria: z.literal("workflow-acceptance-criteria") }).strict(),
  /** The Stage values the workflow writes, by stable id; the interface names them in its language. */
  stages: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/) }).strict()).min(1).max(16),
  steps: z.array(recipeStepSchema).min(1).max(32),
  /** Where a rework run starts; everything before it is carried from the accepted run. */
  reworkFrom: stepId,
}).strict();
export type WorkflowRecipe = z.infer<typeof workflowRecipeSchema>;

type ValueType = "text" | "ref" | "refs" | "decision" | "digest" | "receipt" | "witness";
/** What each step produces, by kind and action; a reference may only name one of these. */
export function stepOutputs(step: RecipeStep): Record<string, ValueType> {
  if (step.kind === "agent.run") return { result: "text", artifactRef: "ref", chatRef: "ref", evidenceRefs: "refs" };
  if (step.kind === "human.confirm") return { decision: "decision", proposalDigest: "digest" };
  /* The witness names each input field's last change, so a rework draft can tell an edit from none, A→B→A included. */
  if (step.action === "base.read") return { task: "text", acceptanceCriteria: "text", witness: "witness" };
  return { receipt: "receipt" };
}
/** What an action needs; an input that feeds one of these must have that type. */
const EXPECTED: Record<string, Record<string, ValueType>> = {
  "base.write-summary": { summary: "text" }, "human.confirm": { proposal: "text" }, "agent.run": { task: "text", acceptanceCriteria: "text", plan: "text", implementation: "text" },
};

export type RecipeIssue = { stepId: string | null; code: "duplicate-step" | "unknown-reference" | "forward-reference" | "type-mismatch" | "unknown-stage"
  | "unknown-rework-start" | "confirmation-order" | "missing-input" ; detail: string };
/**
 * The static check: unique step ids; references only to inputs or earlier steps' declared outputs (so nothing
 * forward or circular); types match what the consuming action needs; Stage writes name declared stages; rework starts at
 * an existing step after the plan is confirmed.
 */
export function checkRecipe(input: unknown): { ok: true; recipe: WorkflowRecipe } | { ok: false; issues: RecipeIssue[] } {
  const parsed = workflowRecipeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: [{ stepId: null, code: "type-mismatch", detail: parsed.error.issues[0]?.message ?? "invalid recipe" }] };
  const recipe = parsed.data, issues: RecipeIssue[] = [], seen = new Map<string, RecipeStep>();
  const stageIds = new Set(recipe.stages.map(stage => stage.id));
  for (const step of recipe.steps) {
    if (seen.has(step.id)) issues.push({ stepId: step.id, code: "duplicate-step", detail: step.id });
    const expected = EXPECTED[step.kind === "app.call" ? step.action : step.kind] ?? {};
    for (const [key, value] of Object.entries(step.inputs)) {
      if (typeof value !== "object" || value === null) {
        if (step.kind === "app.call" && step.action === "base.set-stage" && key === "stage" && (typeof value !== "string" || !stageIds.has(value))) {
          issues.push({ stepId: step.id, code: "unknown-stage", detail: String(value) });
        }
        continue;
      }
      const path = value.$from.split(".");
      let type: ValueType | undefined;
      if (path[0] === "inputs") type = recipe.inputs[path[1]!];
      else {
        const source = seen.get(path[1]!);
        if (!source) { issues.push({ stepId: step.id, code: recipe.steps.some(item => item.id === path[1]) ? "forward-reference" : "unknown-reference", detail: value.$from }); continue; }
        type = stepOutputs(source)[path[3]!];
      }
      if (!type) { issues.push({ stepId: step.id, code: "unknown-reference", detail: value.$from }); continue; }
      if (expected[key] && expected[key] !== type) issues.push({ stepId: step.id, code: "type-mismatch", detail: `${key}: ${type} ≠ ${expected[key]}` });
    }
    if (step.kind === "app.call" && step.action === "base.set-stage" && !("stage" in step.inputs)) issues.push({ stepId: step.id, code: "missing-input", detail: "stage" });
    seen.set(step.id, step);
  }
  const rework = recipe.steps.findIndex(step => step.id === recipe.reworkFrom);
  if (rework < 0) issues.push({ stepId: null, code: "unknown-rework-start", detail: recipe.reworkFrom });
  const planConfirmed = recipe.steps.findIndex(step => step.kind === "human.confirm" && step.confirmation === "plan");
  if (rework >= 0 && planConfirmed >= 0 && rework < planConfirmed) issues.push({ stepId: recipe.reworkFrom, code: "confirmation-order", detail: "rework must start after the plan is confirmed" });
  return issues.length ? { ok: false, issues } : { ok: true, recipe };
}
