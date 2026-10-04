/**
 * [INPUT]: Depends on the run contract's mayStillRun and StopProof and the run ledger and agent (processOf, verifyGroup) ports.
 * [OUTPUT]: Provides settleFromCustody (stopped only when custody holds nothing for the run's live attempts) and settleUnconfirmed (stopped only when every recorded group is proven ended).
 * [POS]: workflows/executor's evidence-only stop settlement (06 §8, review-0926 F1), used by cancel, Force stop and startup recovery in index.ts.
 */
import { mayStillRun, type StopProof, type WorkflowRun } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import type { ExecutorPorts } from "./types";

/**
 * Stopped when custody holds nothing for any open attempt's request, nor for the last attempt of a step whose cleanup is unknown
 * (an attempt never sent holds nothing); otherwise unconfirmed with what it holds.
 */
export async function settleFromCustody(ports: Pick<ExecutorPorts, "ledger" | "agent">, run: WorkflowRun, proof: StopProof) {
  const requests = run.steps.flatMap(step => step.state === "running" ? step.attempts.filter(item => item.outcome === "open" && item.requestId).map(item => item.requestId!)
    : mayStillRun(step) ? [step.attempts.at(-1)!.requestId!] : []);
  const held = (await Promise.all(requests.map(requestId => ports.agent.processOf(requestId)))).flatMap(item => item.state === "held" ? [item.group] : []);
  return held.length ? ports.ledger.forceStopUnconfirmed(run.runId, held.slice(0, 8)) : ports.ledger.forceStop(run.runId, proof);
}

/** Stopped only on positive evidence: every recorded group proven ended. No group recorded proves nothing. */
export async function settleUnconfirmed(ports: Pick<ExecutorPorts, "ledger" | "agent">, runId: string, groups: WorkflowRun["forceStopGroups"], detail: "force-stopped" | "force-stopped-confirmed-at-startup") {
  const verdicts = await Promise.all(groups.map(group => ports.agent.verifyGroup(group)));
  return groups.length && verdicts.every(verdict => verdict === "gone")
    ? ports.ledger.forceStop(runId, detail)
    : ports.ledger.forceStopUnconfirmed(runId, groups.filter((_, index) => verdicts[index] !== "gone"));
}
