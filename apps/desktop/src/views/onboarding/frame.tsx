/**
 * [INPUT]: The onboarding path, product identity, SlimScroller and i18n.
 * [OUTPUT]: OnboardingFrame — one full-window column with step progress, the product mark aligned with the title, a full-width description below, and the body — and OnboardingActions, the row a step body ends with.
 * [POS]: Presentation shell of views/onboarding; index.tsx and the step bodies compose into it.
 */
import type { ReactNode } from "react";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { PRODUCT_MARK_URL } from "@ai-chat/ui/components/workspace/brand";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { onboardingSteps, type OnboardingStep } from "./plan";

/** Copy ids predate the folder step's code id; every catalog table is keyed by them. */
export const onboardingCopyId = (step: OnboardingStep) => step === "folder" ? "chat-home" : step;

/* The same progress a Settings step dialog shows: the label is what is read, the segments only echo it. */
function StepProgress({ step }: { step: OnboardingStep }) {
  const { t } = useAppTranslation();
  const index = onboardingSteps.indexOf(step) + 1, total = onboardingSteps.length;
  const label = t("common.stepOf", { current: index, total });
  return <div className="flex items-center justify-between gap-4">
    <p className="text-muted-foreground text-xs">{label}</p>
    <span aria-hidden="true" className="flex gap-1">
      {onboardingSteps.map((id, position) => (
        <span key={id} className={cn("h-[3px] w-4 rounded-[2px]", position < index ? "bg-foreground" : "bg-border")} />
      ))}
    </span>
  </div>;
}

/** Actions follow the body instead of pinning to the window's edge. */
export function OnboardingActions({ children }: { children: ReactNode }) {
  return <div data-onboarding-actions="" className="mt-8 flex min-w-0 items-center gap-2">{children}</div>;
}

export function OnboardingFrame({ step, title, description, children }: {
  step: OnboardingStep | null;
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  /* One column and nothing beside it: the step is the only thing on screen, so there is never a question of where to look. */
  return <div className="flex h-svh min-w-0 flex-col overflow-hidden bg-background">
    {/* The bar holds no controls and no identity, so all of it moves the window. */}
    <div data-onboarding-drag="" className="h-[52px] shrink-0 select-none [-webkit-app-region:drag]" />
    <SlimScroller className="min-h-0 flex-1 overflow-y-auto px-8">
      <main className="mx-auto flex w-full max-w-[560px] flex-col pt-[clamp(1.5rem,6vh,3rem)] pb-12">
        {step && <StepProgress step={step} />}
        {title && <header className="mt-4 flex flex-col gap-2">
          <div className="flex min-w-0 items-center gap-3.5">
            <img src={PRODUCT_MARK_URL} alt="" className="size-10 shrink-0 object-contain" />
            <h1 className="min-w-0 font-semibold text-2xl tracking-[-0.3px]">{title}</h1>
          </div>
          {description && <p className="text-[13px] text-muted-foreground leading-[1.6]">{description}</p>}
        </header>}
        <div className="mt-7 flex flex-col gap-3">{children}</div>
      </main>
    </SlimScroller>
  </div>;
}
