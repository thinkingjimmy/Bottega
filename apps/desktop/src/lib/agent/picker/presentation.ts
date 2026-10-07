/**
 * [INPUT]: Provider catalog entries, History source identifiers, independent runtime/auth facts and shared native/remote picker presentation.
 * [OUTPUT]: Installed-provider visibility for Composer and History import, quota-demand eligibility and login-first, quota-first picker presentation
 * [POS]: Pure Agent picker policy; UI rendering and main-process execution admission remain separate consumers of the facts.
 */
import type { BackendInfo } from "../../../../shared/ipc/agent/agent-ipc";
import type { ProviderCatalogSnapshot } from "../../../../shared/providers/catalog-ipc";
import type { AvailabilityState } from "../../../../shared/agent-availability/types";
import { activeNegative } from "../../../../shared/agent-availability/projection";
import { projectAgentPickerPresentation } from "@ai-chat/chat-ui/agent-picker/presentation";
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
  return projectAgentPickerPresentation({ state, limits, signedOut: signedOut(backend),
    checking: backend?.authStatus === "checking" && !backend.availability?.lastConfirmedAuth,
    updateAvailable: backend?.updateAvailable });
}
