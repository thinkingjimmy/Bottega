/**
 * [INPUT]: Depends on the run contract's BlockedReason, the WorkflowRun shape and the binding contract's BINDING_REASONS.
 * [OUTPUT]: Provides providerOf (a frozen configuration's Provider), baseActionReason (a failed Base action typed as binding-suspended or base-action-failed) and resolved (a step's inputs with their `$from` references resolved against the run).
 * [POS]: workflows/executor's pure helpers, shared by index.ts and report-repair.ts.
 */
import type { BlockedReason, WorkflowRun } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import { BINDING_REASONS } from "@ai-chat/cloud-protocol/contracts/base/binding";

export const providerOf = (config: unknown) => (config as { resolved?: { provider?: string } } | undefined)?.resolved?.provider ?? null;
/**
 * A failed Base action, typed: the binding's own problems (Base gone, a bound column changed, the record deleted) are
 * binding-suspended with the cause; anything else is base-action-failed with the action and a closed failure.
 */
export function baseActionReason(action: string, cause: unknown): BlockedReason {
  const message = cause instanceof Error ? cause.message : String(cause);
  const suspended = (reason: BlockedReason["cause"]) => ({ kind: "binding-suspended" as const, provider: null, role: null, cause: reason, action: null, failure: null, extractor: null });
  const bound = BINDING_REASONS.find(reason => message === `workflow-binding-suspended:${reason}`);
  if (bound) return suspended(bound);
  if (message === "workflow-base-missing") return suspended("instance-changed");
  if (message === "workflow-record-missing") return suspended("record-missing");
  const status = (cause as { status?: number } | null)?.status;
  const failure = status === 403 ? "write-refused" as const : status === 409 ? "conflict" as const
    : status === 404 || /recovery is required|LIBRARY_NOT_CONFIGURED|save outcome is unknown/i.test(message) ? "base-unavailable" as const : "unknown" as const;
  const name = action.replace(/^base\./, "");
  return { kind: "base-action-failed", provider: null, role: null, cause: null, failure, extractor: null,
    action: name === "read" || name === "set-stage" || name === "write-summary" ? name : null };
}

const resolveRef = (run: WorkflowRun, value: unknown): unknown => {
  const from = (value as { $from?: string } | null)?.$from;
  if (typeof from !== "string") return value;
  const path = from.split(".");
  if (path[0] === "inputs") return run.inputs[path[1]!];
  const output = run.steps.find(step => step.stepId === path[1])?.output as Record<string, unknown> | null | undefined;
  return output?.[path[3]!];
};
export const resolved = (run: WorkflowRun, inputs: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, resolveRef(run, value)]));
