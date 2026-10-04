/**
 * [INPUT]: Depends on @ai-chat/base-core semantic contracts and the workflow-column rule, the shared DropdownMenu, the Base action-button class, workbench-copy and the
 *          host's Base translation.
 * [OUTPUT]: Provides the one presentation of a column only a workflow may change: WorkflowColumnMark (lock + "Workflow" beside a
 *           column or field name; when the name would not fit whole, "Workflow" gives way first, then the lock, the name last),
 *           WORKFLOW_CELL_CLASS (grey cell ground), WorkflowFieldValue (dashed box with "Set by the
 *           workflow"), WorkflowWritableByMenu ("Who can edit", workflow columns only) and useWorkflowCopy.
 * [POS]: Shared by the table, list, Kanban and record editor so the four surfaces cannot drift (4-ui §7 States, Q37).
 */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { LockIcon } from "lucide-react";
import type { BaseColumn } from "@ai-chat/base-core/model/bases-ipc";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import { useWorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { cn } from "@ai-chat/ui/lib/utils";
import { effectiveWritableBy } from "@ai-chat/base-core/compute/workflow-columns";
import { useAppTranslation } from "../platform/i18n";
import { baseActionButtonClass, baseMenuItemHoverClass } from "./base-toolbar";

export function useWorkflowCopy() {
  const { i18n } = useAppTranslation();
  return useWorkbenchCopy(i18n.language);
}

/* Opaque on purpose: a frozen cell paints over the cells scrolling beneath it. */
export const WORKFLOW_CELL_CLASS = "bg-[color-mix(in_oklab,var(--muted)_55%,var(--background))]";

/**
 * The name beside the mark comes first, then the lock, and "Workflow" gives way first (Q37): each step is kept only while
 * nothing else in the row overflows or truncates. Measured before paint on every resize, so nothing flickers.
 */
function useNameComesFirst(word: string) {
  const mark = useRef<HTMLSpanElement>(null), lock = useRef<SVGSVGElement>(null), text = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const own = mark.current, row = own?.parentElement;
    if (!own || !row || !text.current || !lock.current) return;
    const crowded = () => row.scrollWidth > row.clientWidth + 1
      || Array.from(row.querySelectorAll<HTMLElement>("*")).some(item => !own.contains(item) && item.scrollWidth > item.clientWidth + 1);
    const fit = () => {
      text.current!.style.maxWidth = ""; lock.current!.style.display = "";
      let level: "full" | "lock" | "none" = "full";
      if (crowded()) { text.current!.style.maxWidth = "0px"; level = "lock"; }
      if (level === "lock" && crowded()) { lock.current!.style.display = "none"; level = "none"; }
      own.dataset.fit = level;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    return () => observer.disconnect();
  }, [word]);
  return { mark, lock, text };
}

export function WorkflowColumnMark({ className }: { className?: string }) {
  const workbench = useWorkflowCopy();
  const { mark, lock, text } = useNameComesFirst(workbench.readOnly.badge);
  return (
    <span ref={mark} className={cn("inline-flex shrink-0 items-center gap-0.5 font-normal text-[10px] text-muted-foreground", className)}
      data-workflow-mark="" title={workbench.readOnly.setByWorkflow}>
      <LockIcon ref={lock} aria-hidden className="size-3 shrink-0" />
      <span ref={text} aria-hidden className="overflow-hidden whitespace-nowrap">{workbench.readOnly.badge}</span>
      <span className="sr-only">{workbench.readOnly.columnHint}</span>
    </span>
  );
}

/** Read-only field in a form: the value as it reads elsewhere, inside a dashed box, and who sets it. */
export function WorkflowFieldValue({ id, children }: { id?: string; children: ReactNode }) {
  const workbench = useWorkflowCopy();
  return (
    <div id={id} aria-readonly="true" data-workflow-field=""
      className="flex min-h-9 items-center justify-between gap-3 rounded-md border border-dashed px-3 py-1.5 text-sm">
      <span className="min-w-0 truncate">{children}</span>
      <span className="shrink-0 text-muted-foreground text-xs">{workbench.readOnly.setByWorkflow}</span>
    </div>
  );
}

/** "Who can edit" is offered only on the two columns a workflow adds (Q37); a person's change goes through updateMeta. */
export function WorkflowWritableByMenu({ column, disabled, onChange }: {
  column: BaseColumn;
  disabled?: boolean;
  onChange(writableBy: "everyone" | "workflows"): void;
}) {
  const workbench = useWorkflowCopy();
  if (!column.workflow) return null;
  const copy = workbench.readOnly;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label={`${copy.whoCanEdit}: ${column.name}`} className={baseActionButtonClass} disabled={disabled}
          data-writable-by-trigger={column.id} title={copy.whoCanEdit} type="button">
          <LockIcon className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-muted-foreground text-xs">{copy.whoCanEdit}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={effectiveWritableBy(column)} onValueChange={value => onChange(value as "everyone" | "workflows")}>
          <DropdownMenuRadioItem className={baseMenuItemHoverClass} value="everyone">{copy.everyone}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem className={baseMenuItemHoverClass} value="workflows">{copy.onlyWorkflows}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
