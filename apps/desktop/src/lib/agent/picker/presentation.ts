/**
 * [INPUT]: Provider catalog entries, supported History source identifiers, independent runtime/auth facts, availability states and quota snapshots.
 * [OUTPUT]: Installed-provider visibility for Composer and History import, quota-demand eligibility and login-first, quota-first picker presentation
 * [POS]: Pure Agent picker policy; UI rendering and main-process execution admission remain separate consumers of the facts.
 */
import type { BackendInfo } from "../../../../shared/ipc/agent/agent-ipc";
import type { ProviderCatalogSnapshot } from "../../../../shared/providers/catalog-ipc";
import type { AvailabilityState } from "../../../../shared/agent-availability/types";
import { activeNegative } from "../../../../shared/agent-availability/projection";
import { generalQuotaWindows } from "../../../../shared/usage-limits/projection";
import type { AgentUsageLimits } from "../../../../shared/usage-limits/types";
import { HISTORY_SOURCE_KINDS } from "../../../../shared/ipc/content/history-import-ipc";
type PickerBackend = Pick<BackendInfo, "runtimeStatus" | "authStatus" | "availability" | "updateAvailable">;

export function installedPickerProvider(entry: Pick<ProviderCatalogSnapshot["entries"][number], "source" | "unavailableReason">, backend?: PickerBackend) {
  return entry.source === "package" ? entry.unavailableReason !== "package-removed"
    : backend?.runtimeStatus === "installed" || backend?.runtimeStatus === "unsupported";
}

export function installedHistorySources(backends: readonly BackendInfo[]) {
  return HISTORY_SOURCE_KINDS.filter(kind => installedPickerProvider({ source: "builtin" }, backends.find(backend => backend.id === kind)));
}

function signedOut(backend?: PickerBackend) {
  const facts = backend?.availability;
  return facts ? Boolean(activeNegative(facts.lastConfirmedAuth, facts.environmentGeneration))
    : backend?.authStatus === "unauthenticated";
}

export function pickerQuotaEligible(backend?: PickerBackend) {
  return backend?.runtimeStatus === "installed" && !signedOut(backend) && backend.availability?.route !== "custom";
}

export function projectPickerPresentation(backend: PickerBackend | undefined, state: AvailabilityState, limits?: AgentUsageLimits) {
  const login = signedOut(backend) || limits?.availability === "needs-auth";
  const displayState = login ? "sign-in" : backend?.authStatus === "checking" && !backend.availability?.lastConfirmedAuth ? "checking" : state;
  const hasQuota = limits?.availability === "available" && generalQuotaWindows(limits).some(window => window.usedPercent !== null);
  const showQuota = ["ready", "unverified"].includes(displayState) || displayState === "unsupported" && hasQuota;
  const update = displayState === "unsupported" && !hasQuota ? "required"
    : showQuota && (backend?.updateAvailable || displayState === "unsupported") ? "available" : undefined;
  return { state: displayState, showQuota, update } as const;
}
