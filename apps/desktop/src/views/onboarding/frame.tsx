/**
 * [INPUT]: The onboarding path, shared SetupFrame and i18n.
 * [OUTPUT]: OnboardingFrame — one full-window column with step progress, the product mark aligned with the title, a full-width description below, and the body — and OnboardingActions, the row a step body ends with.
 * [POS]: Presentation shell of views/onboarding; index.tsx and the step bodies compose into it.
 */
import type { ReactNode } from "react";
import { SetupFrame } from "@ai-chat/ui/components/ui/setup-step";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { onboardingSteps, type OnboardingStep } from "./plan";

/** Copy ids predate the folder step's code id; every catalog table is keyed by them. */
export const onboardingCopyId = (step: OnboardingStep) => step === "folder" ? "chat-home" : step;

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
  const { t } = useAppTranslation();
  const current = step ? onboardingSteps.indexOf(step) + 1 : 0, total = onboardingSteps.length;
  return <SetupFrame draggable title={title} description={description}
    progress={step ? { current, total, label: t("common.stepOf", { current, total }) } : undefined}>{children}</SetupFrame>;
}
