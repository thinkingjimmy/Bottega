/**
 * [INPUT]: Onboarding requirement facts and the first confirmed cloud account projection.
 * [OUTPUT]: Pure path plans, protocol-safe usage-mode destinations, account recovery predicates and one-time destination selection.
 * [POS]: Navigation policy library; React renders its decisions without owning another admission gate.
 */
import type { CloudAccountState } from "../../../shared/cloud-ipc";
import { requiresSyncSetup } from "../../../shared/cloud/sync";
import type { OnboardingFacts } from "@/lib/onboarding-gate";

export type OnboardingMode = "local" | "account";
export type OnboardingStep = "folder" | "mode" | "account" | "agent" | "extras";
export type OnboardingTarget = "agent";
export type OnboardingCursor = { mode: OnboardingMode; step: OnboardingStep };
export const onboardingSteps = (mode: OnboardingMode): readonly OnboardingStep[] =>
  mode === "account" ? ["folder", "mode", "account", "agent"] : ["folder", "mode", "agent", "extras"];
export const accountComplete = (state: CloudAccountState) => Boolean(state.profile &&
  !requiresSyncSetup(state.sync) && ["unlocked", "not-configured"].includes(state.encryption.status));
export const accountNeedsRecovery = (state: CloudAccountState) => Boolean(state.pendingLogin ||
  state.status === "signing-in" || state.profile && !accountComplete(state));
export const accountModeBlocked = (state: CloudAccountState) =>
  state.status === "client-outdated" || state.status === "environment-mismatch";

export function modeDestination(mode: OnboardingMode, state: CloudAccountState): "agent" | "account" | null {
  const blocked = accountModeBlocked(state);
  // Existing identities can revisit Agent setup without requesting a blocked account operation.
  if (mode === "local" || blocked && state.profile) return "agent";
  return blocked ? null : "account";
}

export function initialOnboardingCursor({ facts, account, accountLoaded, target }: {
  facts: OnboardingFacts; account: CloudAccountState; accountLoaded: boolean; target?: OnboardingTarget | null;
}): OnboardingCursor | null {
  if (facts["chat-home"] === "missing") return { mode: "local", step: "folder" };
  if (facts["chat-home"] !== "satisfied" || !accountLoaded) return null;
  const mode = account.profile || accountNeedsRecovery(account) ? "account" : "local";
  if (target) return { mode, step: target };
  if (!account.profile && account.status === "connecting") return null;
  if (accountNeedsRecovery(account)) return { mode: "account", step: "account" };
  if (facts.agent === "unknown") return null;
  return { mode, step: "agent" };
}
