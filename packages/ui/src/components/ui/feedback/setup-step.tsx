/**
 * [INPUT]: Depends on React identity, caller-owned step labels and localized progress templates, shared class composition, SlimScroller and the product mark.
 * [OUTPUT]: Provides setupStepCaption, SetupStep and SetupFrame — shared step content and the full-window desktop/mobile onboarding column.
 * [POS]: packages/ui/src/components/ui/feedback; Shared onboarding presentation for desktop, mobile and browser account admission, without account or navigation authority.
 */
import { useId, type ReactNode } from "react";
import { cn } from "../../../lib/utils";
import { SlimScroller } from "../layout/slim-scroller";
import { PRODUCT_MARK_URL } from "../../workspace/brand";

export function SetupFrame({ progress, title, description, children, draggable = false, titleId, descriptionId }: {
  progress?: { current: number; total: number; label: string };
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  draggable?: boolean;
  titleId?: string;
  descriptionId?: string;
}) {
  const id = useId(), heading = titleId ?? `${id}-title`;
  return <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background", draggable && "h-svh")} data-setup-frame="">
    {draggable && <div data-onboarding-drag="" className="h-[52px] shrink-0 select-none [-webkit-app-region:drag]" />}
    <SlimScroller className="min-h-0 flex-1 overflow-y-auto px-6 sm:px-8">
      <main aria-labelledby={title ? heading : undefined} className="mx-auto flex w-full max-w-[560px] flex-col pt-[clamp(1.5rem,6vh,3rem)] pb-[max(3rem,env(safe-area-inset-bottom))]">
        {progress && <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">{progress.label}</p>
          <span aria-hidden="true" className="flex shrink-0 gap-1">{Array.from({ length: progress.total }, (_, position) =>
            <span key={position} className={cn("h-[3px] w-4 rounded-[2px]", position < progress.current ? "bg-foreground" : "bg-border")} />)}</span>
        </div>}
        {title && <header className="mt-4 flex flex-col gap-2">
          <div className="flex min-w-0 items-center gap-3.5">
            <img src={PRODUCT_MARK_URL} alt="" className="size-10 shrink-0 rounded-[23%] object-contain" />
            <h1 id={heading} className="min-w-0 text-2xl font-semibold tracking-[-0.3px]">{title}</h1>
          </div>
          {description && <p id={descriptionId} className="text-[13px] leading-[1.6] text-muted-foreground">{description}</p>}
        </header>}
        <div className="mt-7 flex flex-col gap-3">{children}</div>
      </main>
    </SlimScroller>
  </div>;
}

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
