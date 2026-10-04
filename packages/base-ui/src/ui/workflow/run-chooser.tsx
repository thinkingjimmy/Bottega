/**
 * [INPUT]: Depends on the shared Popover/Button primitives and workbench-copy.
 * [OUTPUT]: Provides stepChain (a choice's steps as one line) and RunChooser — the ▶ popover of a task (U04): each workflow set up for the Project with its step chain and
 *           Start run, and Set up a workflow… when none is (or to add one).
 * An unconfigured desktop row opens its single enable confirmation directly.
 * The optional openPlugins action explains disabled Workflow choices without starting a run.
 * [POS]: Opened from the title cell's ▶; starting answers the record's active run when it has one (06 §8), so the host
 *        opens that run's details either way.
 */
import { useState, type ReactNode } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@ai-chat/ui/components/ui/popover";
import { formatWorkbench, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { useWorkflowCopy } from "../chrome/workflow-column";
import { displaySteps, type WorkflowRecipeView } from "./port";

export type RunChoice = { id: string; name: string; chain: string };
/** A choice's step chain as a person reads it: Plan → You confirm → Develop → Review → You decide. */
export const stepChain = (recipe: Pick<WorkflowRecipeView, "steps">, setup: WorkbenchCopy["setup"]) => displaySteps(recipe).map(step => step.kind === "agent"
  ? { plan: setup.stepPlan, develop: setup.stepDevelop, review: setup.stepReview }[step.role] : step.kind === "confirm-plan" ? setup.youConfirm : setup.youDecide).join(" → ");
/** `setUp` is absent where a workflow cannot be set up (phone / Web); `unavailable` says why no run can start (a suspended binding). */
export type RunChooserModel = { choices: readonly RunChoice[]; start(id: string): void; setUp?(): void; openPlugins?(): void; unavailable?: string | null };

export function RunChooser({ model, children }: { model: RunChooserModel; children: ReactNode }) {
  const workbench = useWorkflowCopy();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={next => {
      if (next && !model.choices.length && !model.unavailable && model.setUp) { model.setUp(); return; }
      setOpen(next);
    }}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-2 p-3" data-run-chooser="">
        <p className="font-medium text-xs">{workbench.base.runOnTask}</p>
        {model.choices.map(choice => (
          <div key={choice.id} className="flex items-center gap-2 rounded-lg border p-2" data-run-choice={choice.id}>
            <span className="flex min-w-0 flex-1 flex-col"><span className="truncate font-medium text-sm">{choice.name}</span>
              <span className="truncate text-muted-foreground text-xs">{choice.chain}</span></span>
            <Button type="button" size="sm" className="pointer-coarse:h-11" onClick={() => { setOpen(false); model.start(choice.id); }}>{workbench.run.startRun}</Button>
          </div>
        ))}
        {model.unavailable && <p className="text-amber-700 text-xs dark:text-amber-400" data-run-chooser-unavailable="">{model.unavailable}</p>}
        {model.openPlugins && <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); model.openPlugins!(); }}>{formatWorkbench(workbench.plugins.openPlugin, { name: workbench.plugins.builtin.workflow.name })}</Button>}
        {model.setUp && <Button type="button" size="sm" variant="ghost" className="self-start pointer-coarse:h-11" onClick={() => { setOpen(false); model.setUp!(); }}>{workbench.base.setUp}</Button>}
      </PopoverContent>
    </Popover>
  );
}
