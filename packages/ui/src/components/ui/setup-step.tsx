/**
 * [INPUT]: Depends on React identity, caller-owned step labels and localized progress templates, plus shared class composition.
 * [OUTPUT]: Provides setupStepCaption and SetupStep — one shared caption formatter and open-column surface with progress, heading, optional body and actions.
 * [POS]: Shared step surface for desktop onboarding, Sync settings and browser account admission; the page or window is the frame, so it draws no card.
 */
import { useId, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export function setupStepCaption(step: number, steps: readonly string[], template: string): string {
  const progress = template.replace("{{current}}", String(step + 1)).replace("{{total}}", String(steps.length));
  return `${progress} · ${steps[step]}`;
}

export interface SetupStepProps {
  steps: readonly string[];
  step: number;
  /** "Step 3 of 4 · Connect account" in the caller's language; the segments only carry the labels for assistive technology. */
  caption: string;
  title: string;
  description: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  titleId?: string;
  descriptionId?: string;
}
/* One 520px column, left-aligned, centred by its host: progress segments, heading, body, actions. A ghost action
   that opens the row sits flush with the column edge (-ml-3 undoes its own padding). */
export function SetupStep({ steps, step, caption, title, description, children, footer, titleId, descriptionId }: SetupStepProps) {
  const id = useId(), heading = titleId ?? `${id}-title`, detail = descriptionId ?? `${id}-description`;
  return <section aria-labelledby={heading} className="m-auto w-full max-w-[520px]">
    <ol className="flex gap-1.5">{steps.map((label, index) => <li key={index} aria-current={index === step ? "step" : undefined}
      className={cn("h-[3px] min-w-0 flex-1 rounded-[2px]", index <= step ? "bg-foreground" : "bg-border")}><span className="sr-only">{label}</span></li>)}</ol>
    <p className="mt-2.5 text-muted-foreground text-xs/4">{caption}</p>
    <h1 id={heading} className="mt-7 text-balance font-semibold text-[28px]/[34px] tracking-[-0.02em]">{title}</h1>
    <p id={detail} className="mt-2.5 text-pretty text-[15px]/6 text-muted-foreground">{description}</p>
    <div className="mt-7 flex flex-col gap-4 empty:hidden">{children}</div>
    {footer != null && <div className="mt-8 flex flex-wrap items-center justify-between gap-3 [&>[data-variant=ghost]:first-child]:-ml-3">{footer}</div>}
  </section>;
}
