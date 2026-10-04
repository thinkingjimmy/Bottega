/**
 * [INPUT]: The onboarding path, product identity, the Apple title-bar fact, SlimScroller and i18n.
 * [OUTPUT]: OnboardingFrame — one full-window column (title bar with the product mark, the step dialogs' progress label and segments, title, description, body) — and OnboardingActions, the row a step body ends with.
 * [POS]: Presentation shell of views/onboarding; index.tsx and the step bodies compose into it.
 */
import type { ReactNode } from "react";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { PRODUCT_MARK_URL, PRODUCT_NAME } from "@ai-chat/ui/components/workspace/brand";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { isApplePlatform } from "@/lib/platform/platform";
import { onboardingSteps, type OnboardingStep } from "./plan";

/** Copy ids predate the folder step's code id; every catalog table is keyed by them. */
export const onboardingCopyId = (step: OnboardingStep) => step === "folder" ? "chat-home" : step;

/* The same progress a Settings step dialog shows: the label is what is read, the segments only echo it. */
function StepProgress({ step }: { step: OnboardingStep }) {
  const { t } = useAppTranslation();
  const index = onboardingSteps.indexOf(step) + 1, total = onboardingSteps.length;
  const label = t("common.stepOf", { current: index, total });
  return <div className="flex items-center justify-between gap-4">
    <p className="text-muted-foreground text-xs">{step === "extras" ? `${label} · ${t("onboarding.optional")}` : label}</p>
    <span aria-hidden="true" className="flex gap-1">
      {onboardingSteps.map((id, position) => (
        <span key={id} className={cn("h-[3px] w-4 rounded-[2px]", position < index ? "bg-foreground" : "bg-border")} />
      ))}
    </span>
  </div>;
}

/** Back on the left, everything else pushed right; it follows the body instead of pinning to the window's edge. */
export function OnboardingActions({ children }: { children: ReactNode }) {
  return <div data-onboarding-actions="" className="mt-8 flex min-w-0 items-center gap-2">{children}</div>;
}

export function OnboardingFrame({ step, title, description, children }: {
  step: OnboardingStep | null;
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  const apple = isApplePlatform();
  /* One column and nothing beside it: the step is the only thing on screen, so there is never a question of where to look. */
  return <div className="flex h-svh min-w-0 flex-col overflow-hidden bg-background">
    {/* The bar holds no controls, so all of it moves the window; on macOS the mark sits after the traffic lights. */}
    <header className={cn("flex h-[52px] shrink-0 select-none items-center gap-2 [-webkit-app-region:drag]", apple ? "pl-[88px]" : "pl-5")}>
      <img src={PRODUCT_MARK_URL} alt="" className="size-5 object-contain" />
      <span className="font-semibold text-[13px]">{PRODUCT_NAME}</span>
    </header>
    <SlimScroller className="min-h-0 flex-1 overflow-y-auto px-8">
      <main className="mx-auto flex w-full max-w-[560px] flex-col pt-[clamp(2rem,9vh,4.5rem)] pb-12">
        {step && <StepProgress step={step} />}
        {title && <header className="mt-2.5 flex flex-col gap-2">
          <h1 className="font-semibold text-2xl tracking-[-0.3px]">{title}</h1>
          {description && <p className="text-[13px] text-muted-foreground leading-[1.6]">{description}</p>}
        </header>}
        <div className="mt-7 flex flex-col gap-3">{children}</div>
      </main>
    </SlimScroller>
  </div>;
}
