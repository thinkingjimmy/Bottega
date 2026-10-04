/**
 * [INPUT]: Depends on the workflow evidence capture (captureCodeEvidence) and the WorkflowRun shape.
 * [OUTPUT]: Provides recordEvidence (what development leaves for review) and developEvidence (what review is handed).
 * [POS]: workflows/executor's review evidence, used by index.ts's latch and dispatch.
 */
import type { WorkflowRun } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import { captureCodeEvidence, type CodeEvidence, type CommandEvidence } from "../evidence";
import type { ExecutorPorts, StepEvidence } from "./types";

/** After development: the code as it is now and the commands the turn actually ran (W16). */
export async function recordEvidence(ports: Pick<ExecutorPorts, "workspaceOf" | "evidence">, run: WorkflowRun, commands: CommandEvidence[] | null): Promise<StepEvidence> {
  const workspace = ports.workspaceOf(run);
  const code = workspace ? await captureCodeEvidence(workspace, ports.evidence) : null;
  return { code, commands };
}
/** The evidence the run's development step recorded, for review. */
export function developEvidence(run: WorkflowRun): [CodeEvidence | null, CommandEvidence[] | null] {
  const develop = run.recipe.steps.find(step => step.kind === "agent.run" && step.role === "develop");
  const evidence = (run.steps.find(step => step.stepId === develop?.id)?.output as { evidence?: StepEvidence } | null | undefined)?.evidence;
  return [evidence?.code ?? null, evidence?.commands ?? null];
}
