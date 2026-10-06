/**
 * [INPUT]: Onboarding requirement facts.
 * [OUTPUT]: The two-step onboarding path and the step a fresh or reopened session starts on.
 * [POS]: Navigation policy library for OnboardingView; it reads no account state, because signing in is not an onboarding branch.
 */
import type { OnboardingFacts } from "@/lib/settings/onboarding/onboarding-gate";

export type OnboardingStep = "folder" | "agent";
export type OnboardingTarget = "agent";
/* One path for everyone: a folder, then an Agent (or Install later).
   Signing in belongs to Settings, where it is also what publishes this computer. */
export const onboardingSteps: readonly OnboardingStep[] = ["folder", "agent"];

export function initialOnboardingStep({ facts, target }: {
  facts: OnboardingFacts; target?: OnboardingTarget | null;
}): OnboardingStep | null {
  if (facts["chat-home"] === "missing") return "folder";
  // An unsettled fact seeds nothing: a cursor placed on a guess would have to move under the reader.
  if (facts["chat-home"] !== "satisfied") return null;
  if (target) return target;
  return facts.agent === "unknown" ? null : "agent";
}
