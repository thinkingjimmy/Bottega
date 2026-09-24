/**
 * [INPUT]: The onboarding path, product identity, the Apple title-bar fact, SlimScroller and i18n.
 * [OUTPUT]: OnboardingFrame — the step rail on the window background and the Settings-like content panel whose footer bar stays fixed while the step body scrolls.
 * [POS]: Presentation shell of views/onboarding; index.tsx composes the step bodies and actions into it.
 */
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { PRODUCT_MARK_URL, PRODUCT_NAME } from "@ai-chat/ui/components/workspace/brand";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { isApplePlatform } from "@/lib/platform";
import { onboardingSteps, type OnboardingStep } from "./plan";

/** Copy ids predate the folder step's code id; every catalog table is keyed by them. */
export const onboardingCopyId = (step: OnboardingStep) => step === "folder" ? "chat-home" : step;

function StepRail({ current }: { current: OnboardingStep | null }) {
  const { t } = useAppTranslation();
  const position = current ? onboardingSteps.indexOf(current) : -1;
  return <ol aria-label={t("onboarding.rail.steps")} className="mt-7 flex flex-col gap-0.5">
    {onboardingSteps.map((step, index) => {
      const active = index === position, done = index < position, id = onboardingCopyId(step);
      return <li key={step} aria-current={active ? "step" : undefined} className={cn(
        "flex items-start gap-3 rounded-[9px] p-2.5",
        active && "bg-background shadow-xs ring-1 ring-foreground/6"
      )}>
        <span className={cn(
          "flex size-[22px] shrink-0 items-center justify-center rounded-full font-semibold text-[11px] tabular-nums",
          done ? "bg-foreground text-background"
            : active ? "text-foreground ring-[1.5px] ring-foreground ring-inset"
              : "text-muted-foreground ring-1 ring-border ring-inset"
        )}>
          {done ? <Check className="size-3" strokeWidth={2.5} aria-hidden="true" /> : index + 1}
        </span>
        <span className="flex min-w-0 flex-col gap-px">
          <span className={cn("text-[13px]", active ? "font-semibold" : "font-medium", !active && !done && "text-muted-foreground")}>
            {t(`onboarding.step.${id}.label`)}
            {done && <span className="sr-only">, {t("onboarding.rail.done")}</span>}
          </span>
          <span className="text-muted-foreground text-xs">{t(`onboarding.step.${id}.hint`)}</span>
        </span>
      </li>;
    })}
  </ol>;
}

export function OnboardingFrame({ step, title, description, footer, children }: {
  step: OnboardingStep | null;
  title?: string;
  description?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useAppTranslation();
  const apple = isApplePlatform();
  return <div className="flex h-svh min-w-0 overflow-hidden bg-sidebar">
    {/* The rail holds no controls, so all of it moves the window; on macOS its top is the traffic lights' band. */}
    <aside className={cn("flex w-[300px] shrink-0 select-none flex-col px-5 pb-6 [-webkit-app-region:drag]", apple ? "pt-[92px]" : "pt-10")}>
      <div className="flex flex-col gap-1.5 px-1.5">
        <span className="flex items-center gap-2.5 font-semibold text-[15px]">
          <img src={PRODUCT_MARK_URL} alt="" className="size-[26px] object-contain" />{PRODUCT_NAME}
        </span>
        <span className="text-muted-foreground text-xs leading-[1.55]">{t("onboarding.rail.intro")}</span>
      </div>
      <StepRail current={step} />
      <span className="mt-auto px-1.5 text-[11px] text-muted-foreground">{t("onboarding.rail.footer", { product: PRODUCT_NAME })}</span>
    </aside>
    <main className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-background shadow-sm ring-1 ring-foreground/6">
      <SlimScroller className="min-h-0 flex-1 overflow-y-auto px-8">
        <section className="mx-auto flex w-full max-w-[640px] flex-col gap-7 pt-[clamp(2.5rem,11vh,5.5rem)] pb-8">
          {title && <header className="flex flex-col gap-2">
            <h1 className="font-semibold text-2xl tracking-[-0.3px]">{title}</h1>
            {description && <p className="max-w-[560px] text-[13px] text-muted-foreground leading-[1.6]">{description}</p>}
          </header>}
          {children}
        </section>
      </SlimScroller>
      <footer className="flex h-16 shrink-0 items-center border-border border-t px-8">
        <div className="mx-auto flex w-full min-w-0 max-w-[640px] items-center gap-2">{footer}</div>
      </footer>
    </main>
  </div>;
}
