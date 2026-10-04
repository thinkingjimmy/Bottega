/**
 * [INPUT]: Depends on the shared Button primitive, the run readers, RunStatusBadge and workbench-copy.
 * [OUTPUT]: Provides RecordWorkflowSection — the Workflow block of Edit record: the record's latest run as its tag (opens the
 *           details), the acceptance result as a label only (the exception reason stays in the run, Q18), each role's Open
 *           Chat, result references, Run workflow, and, while its Develop waits for the workspace (A-07), whose run holds it.
 * [POS]: U04 record entry; the host renders it through the runs context so the record editor stays unaware of runs. Stage
 *        itself is the read-only field above it.
 */
import { MessageSquareIcon, PlayIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { formatWorkbench } from "@ai-chat/ui/lib/workbench-copy";
import { useWorkflowCopy } from "../chrome/workflow-column";
import { RunStatusBadge } from "./run-details";
import type { WorkflowRoleName } from "./port";
import { stepReport, waitingForWorkspace, type WorkflowRunView } from "./run-port";

const ROLES: readonly WorkflowRoleName[] = ["plan", "develop", "review"];

export function RecordWorkflowSection({ run, onRun, onOpenRun, onOpenChat, waitingFor = null, waitingForStuck = false, onOpenHoldingRun }: {
  run: WorkflowRunView | null;
  /** A-07: the task of the run holding the workspace this record's Develop waits for, and a way to open that run. */
  waitingFor?: string | null;
  /** That run may still have a process running, so the wait lasts until it is resolved there. */
  waitingForStuck?: boolean;
  onOpenHoldingRun?(): void;
  /** Absent while a run is active: one active run per record (06 §8). */
  onRun?(): void;
  onOpenRun?(): void;
  onOpenChat(role: WorkflowRoleName): void;
}) {
  const workbench = useWorkflowCopy(), copy = workbench.record, setup = workbench.setup;
  const acceptance = run?.businessOutcome === "accepted" ? copy.accepted : run?.businessOutcome === "accepted-with-exceptions" ? copy.acceptedWithException : copy.notDecided;
  const refs = run ? run.recipe.steps.flatMap(step => {
    const report = stepReport(run, step.id);
    return report ? [report.artifactRef, ...(report.evidenceRefs ?? [])].filter((ref): ref is string => Boolean(ref)) : [];
  }) : [];
  const roleLabel = { plan: setup.stepPlan, develop: setup.stepDevelop, review: setup.stepReview };
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-3 text-sm" data-record-workflow="">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{copy.section}</h3>
        {onRun && <Button type="button" size="sm" variant="outline" className="pointer-coarse:h-11" onClick={onRun}><PlayIcon />{workbench.base.runWorkflow}</Button>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">{copy.run}</dt>
        <dd>{run ? <RunStatusBadge run={run} forced={run.forcedStop} onOpen={onOpenRun} /> : <span className="text-muted-foreground">{copy.noRuns}</span>}</dd>
        <dt className="text-muted-foreground">{copy.acceptance}</dt>
        <dd data-record-acceptance="">{acceptance}</dd>
        {refs.length > 0 && <><dt className="text-muted-foreground">{workbench.run.artifact}</dt>
          <dd className="flex flex-wrap gap-1">{refs.map(ref => <span key={ref} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{ref}</span>)}</dd></>}
      </dl>
      {run && waitingForWorkspace(run) && (
        <p className="flex flex-wrap items-center gap-2 rounded bg-muted px-2 py-1.5 text-xs" role="status" data-record-workspace-wait="">
          <span className="flex flex-1 flex-col">{formatWorkbench(workbench.run.waitingWorkspaceBody, { task: waitingFor ?? "…" })}
            {waitingForStuck && <span className="text-amber-700 dark:text-amber-400">{formatWorkbench(workbench.run.waitingWorkspaceStuck, { task: waitingFor ?? "…" })}</span>}</span>
          {onOpenHoldingRun && <Button type="button" size="sm" variant="outline" className="pointer-coarse:h-11" onClick={onOpenHoldingRun}>{workbench.run.viewHoldingRun}</Button>}
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        {ROLES.map(role => <Button key={role} type="button" size="sm" variant="ghost" className="pointer-coarse:h-11" onClick={() => onOpenChat(role)}
          aria-label={`${workbench.run.openChat}: ${roleLabel[role]}`}><MessageSquareIcon />{roleLabel[role]}</Button>)}
      </div>
    </section>
  );
}
