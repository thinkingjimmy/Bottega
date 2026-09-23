/**
 * [INPUT]: Depends on shared availability facts and an explicit presentation clock.
 * [OUTPUT]: Projects evidence into setup labels, tones, historical readiness, the sign-in action, the required-update verdict and background progress.
 * [POS]: The setup module's atomic presentation layer; it turns runtime/auth facts into one honest status and action model shared by Settings › Providers and Onboarding
 */
import { projectAvailability } from "../../../shared/agent-availability/projection";
import type { AvailabilityState } from "../../../shared/agent-availability/types";
import type { BackendInfo } from "../../../shared/agent-ipc";

export type BackendStatusTone = "positive" | "attention" | "neutral";
export type SetupDisplayState = AvailabilityState | "installed" | "previously-ready" | "check-failed" | "waiting";
export type BackendLoginAction = "login" | "manage";

export type BackendSetupPresentation = {
  status: SetupDisplayState;
  labelKey: string;
  checkedAt?: number;
  tone: BackendStatusTone;
  refreshing: boolean;
  hint: "checking" | "unverified" | "expired" | "failed" | "unsupported" | "sign-in" | "cannot-check" | "cannot-start" | "waiting" | null;
  loginAction: BackendLoginAction | null;
  requiresUpdate: boolean;
};

const STATUS_TONES = {
  installed: "neutral",
  "previously-ready": "neutral",
  "check-failed": "attention",
  waiting: "neutral",
  ready: "positive",
  unverified: "neutral",
  checking: "neutral",
  missing: "attention",
  unsupported: "attention",
  "sign-in": "attention",
  "cannot-check": "attention",
  "cannot-start": "attention",
  "usage-limit": "attention",
  "recent-sign-in": "attention",
  connection: "attention",
  service: "attention",
} as const satisfies Record<SetupDisplayState, BackendStatusTone>;

const SETUP_LABELS: Partial<Record<SetupDisplayState, string>> = {
  installed: "setup.state.installed", "previously-ready": "setup.state.previouslyReady",
  "check-failed": "setup.state.checkFailed", waiting: "setup.state.waiting",
  unsupported: "setup.state.updateRequired", "sign-in": "setup.state.signInRequired",
};

export const backendSetupPresentation = (
  backend: BackendInfo,
  now = Date.now()
): BackendSetupPresentation => {
  const availability = projectAvailability(backend, now);
  const refreshing = !backend.setupAction && (availability.refreshing || backend.authStatus === "checking");
  const facts = backend.availability;
  const confirmed = facts?.lastConfirmedAuth;
  const pastSuccess = confirmed?.status === "authenticated" && confirmed.environmentGeneration === facts?.environmentGeneration;
  let status: SetupDisplayState = availability.state;
  let hint: BackendSetupPresentation["hint"] = null;
  if (backend.setupAction) { status = "waiting"; hint = "waiting"; }
  else if (backend.runtimeStatus === "installed" && availability.policy.decision === "allow") {
    if (pastSuccess) status = confirmed.expiresAt !== undefined && confirmed.expiresAt <= now ? "previously-ready" : "ready";
    else if (status !== "ready") status = refreshing && facts?.lastCheckedAt === undefined ? "checking"
      : backend.authStatus === "error" || facts?.runtimeCheck?.phase === "error" ? "check-failed" : "installed";
    hint = refreshing ? null : backend.authStatus === "error" || facts?.runtimeCheck?.phase === "error" ? "failed" : status === "installed" ? "unverified" : null;
  } else if (!refreshing && ["unsupported", "sign-in", "cannot-check", "cannot-start"].includes(status)) {
    hint = status as "unsupported" | "sign-in" | "cannot-check" | "cannot-start";
  }
  return {
    status, labelKey: SETUP_LABELS[status] ?? `agentAvailability.state.${status}`,
    tone: STATUS_TONES[status], refreshing, hint,
    checkedAt: status === "previously-ready" ? confirmed?.checkedAt : facts?.lastCheckedAt ?? facts?.runtimeCheck?.checkedAt,
    loginAction: backend.runtimeStatus !== "installed" ? null
      : status === "sign-in" ? "login" : backend.capabilities.terminalAuth ? "manage" : null,
    requiresUpdate: backend.runtimeStatus === "unsupported",
  };
};
