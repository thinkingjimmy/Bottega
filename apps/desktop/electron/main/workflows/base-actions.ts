/**
 * [INPUT]: Depends on the Base binding contract (resolveBinding), the recipe's stages and narrow ports over the Base store, its workflow authority and the run-result store.
 * [OUTPUT]: Provides checkBaseRecord (the Base, binding and record prerequisites, checked without acting), createBaseActionPorts (the real ports over BaseStore, BasesService's workflow authority and RunResultStore) and runBaseAction: the three app.call actions of the built-in recipe — base.read (task and criteria with their change witness, Q1), base.set-stage (a declared stage, written by the workflow authority under the run owner's principal, recorded with the run id), base.write-summary (the record's Workflow block under the principal's key, never an ordinary cell).
 * [POS]: The executor's only way into a Base (06 §5, W10, W11). It writes nothing but Stage and Workflow-block summaries, re-checks the binding against the live Base before every action, and never takes a column from anything but the frozen binding.
 */
import { resolveBinding, type BaseBinding } from "@ai-chat/cloud-protocol/contracts/base/binding";
import type { BaseRef } from "@ai-chat/cloud-protocol/contracts/resources";
import type { RecipeStep, WorkflowRecipe } from "@ai-chat/cloud-protocol/contracts/workflow/recipe";
import type { FreshRead } from "@ai-chat/cloud-protocol/contracts/workflow/rework";
import type { BaseStore } from "../bases/base-store";
import type { BasesService } from "../bases/bases-service";
import type { RunResultStore } from "../bases/public/results";
import type { VerifiedPrincipal } from "../operations/principals";

type Column = Readonly<{ id: string; type: string; workflow?: { role: string } }>;
export type BaseActionPorts = {
  /** The live Base for this ref, or null once it is gone. */
  snapshot(ref: BaseRef): Readonly<{ ref: BaseRef; columns: readonly Column[]; rows: readonly Readonly<{ id: string; values: Readonly<Record<string, unknown>> }>[] }> | null;
  cellWitness(ref: BaseRef, rowId: string, columnId: string): string;
  /** A Stage write by the workflow authority under the run owner's principal, recorded in history with the run id. */
  writeStage(ref: BaseRef, rowId: string, columnId: string, stageId: string, principal: VerifiedPrincipal): Promise<void>;
  /** The record's Workflow block: a result slot keyed by label, recorded under the principal's key; returns its reference. */
  attachSummary(ref: BaseRef, rowId: string, label: string, summary: string, principal: VerifiedPrincipal): Promise<string>;
};
export class BaseActionError extends Error {}

const text = (value: unknown) => typeof value === "string" ? value : value == null ? "" : String(value);
const SUMMARY_SLOTS = new Set(["plan", "implementation", "review"]);

/**
 * The prerequisites every action checks against the Base as it is now, without acting: the Base exists, the binding still resolves
 * against it (a recreated Base or a lost column suspends, never writes, F4) and the record is there. Null when all hold.
 */
export function checkBaseRecord(binding: BaseBinding, rowId: string, ports: Pick<BaseActionPorts, "snapshot">): BaseActionError | null {
  const live = ports.snapshot(binding.base);
  if (!live) return new BaseActionError("workflow-base-missing");
  const resolved = resolveBinding(binding, { ref: live.ref, columns: live.columns });
  if (resolved.state === "suspended") return new BaseActionError(`workflow-binding-suspended:${resolved.reasons[0]}`);
  return live.rows.some(item => item.id === rowId) ? null : new BaseActionError("workflow-record-missing");
}

function writer(principal: VerifiedPrincipal | null) {
  if (!principal) throw new BaseActionError("workflow-principal-required");
  return principal;
}

export async function runBaseAction(input: { step: Extract<RecipeStep, { kind: "app.call" }>; args: Readonly<Record<string, unknown>>; binding: BaseBinding;
  recipe: WorkflowRecipe; rowId: string;
  /** The run owner's principal for the step attempt; a read outside any attempt passes null, and a write without one is refused. */
  principal: VerifiedPrincipal | null; ports: BaseActionPorts }) {
  const { binding, rowId, ports } = input;
  const broken = checkBaseRecord(binding, rowId, ports);
  if (broken) throw broken;
  const row = ports.snapshot(binding.base)!.rows.find(item => item.id === rowId)!;
  switch (input.step.action) {
    case "base.read": {
      const output: FreshRead = { task: text(row.values[binding.taskNameColumnId]), acceptanceCriteria: text(row.values[binding.acceptanceCriteriaColumnId]),
        witness: { task: ports.cellWitness(binding.base, rowId, binding.taskNameColumnId),
          acceptanceCriteria: ports.cellWitness(binding.base, rowId, binding.acceptanceCriteriaColumnId) } };
      return output;
    }
    case "base.set-stage": {
      const stage = input.args.stage;
      if (typeof stage !== "string" || !input.recipe.stages.some(item => item.id === stage)) throw new BaseActionError("workflow-stage-undeclared");
      await ports.writeStage(binding.base, rowId, binding.stageColumnId, stage, writer(input.principal));
      return { receipt: `stage:${stage}` };
    }
    case "base.write-summary": {
      const slot = input.args.slot, summary = input.args.summary;
      if (typeof slot !== "string" || !SUMMARY_SLOTS.has(slot) || typeof summary !== "string" || !summary) throw new BaseActionError("workflow-summary-invalid");
      return { receipt: await ports.attachSummary(binding.base, rowId, `workflow:${slot}`, summary, writer(input.principal)) };
    }
  }
}

/** The production ports: the live Base from the store, Stage through the workflow authority, summaries in the run-result store. */
export function createBaseActionPorts(input: {
  store: Pick<BaseStore, "peek" | "cellWitness">;
  service: Pick<BasesService, "issueWorkflowMutationAuthority" | "patchRows">;
  results: Pick<RunResultStore, "attach">;
}): BaseActionPorts {
  return {
    snapshot: ref => {
      const live = input.store.peek(ref.ownerKey);
      return live ? { ref: { ownerKey: ref.ownerKey, ownerInstanceId: live.meta.ownerInstanceId }, columns: live.meta.columns, rows: live.rows } : null;
    },
    cellWitness: (ref, rowId, columnId) => input.store.cellWitness(ref.ownerKey, ref.ownerInstanceId, rowId, columnId),
    writeStage: async (ref, rowId, columnId, stageId, principal) => {
      await input.service.patchRows(ref.ownerKey, [{ rowId, patch: { [columnId]: stageId } }],
        await input.service.issueWorkflowMutationAuthority(ref.ownerKey, "row-patch", principal));
    },
    attachSummary: async (ref, rowId, label, summary, principal) => {
      principal.assertCurrent();
      return (await input.results.attach({ ownerInstanceId: ref.ownerInstanceId, rowId, report: summary, label,
        truncated: false, summaryColumnId: null, principal: principal.key })).resultRef;
    },
  };
}
