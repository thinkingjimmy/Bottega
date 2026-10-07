/**
 * [INPUT]: Host-projected availability states, quota snapshots and optional update facts.
 * [OUTPUT]: Shared login precedence and quota/update presentation for native and remote Agent menus.
 * [POS]: Pure picker policy; display facts never grant permission to execute a turn.
 */
import type { AgentUsageLimits } from "@ai-chat/cloud-protocol/remote/quota";
import { generalQuotaWindows } from "@ai-chat/cloud-protocol/remote/quota-view";

export function projectAgentPickerPresentation<State extends string>({ state, signedOut = false, checking = false, updateAvailable = false, limits }: {
  state: State;
  signedOut?: boolean;
  checking?: boolean;
  updateAvailable?: boolean;
  limits?: AgentUsageLimits;
}) {
  const displayState = signedOut || limits?.availability === "needs-auth" ? "sign-in" : checking ? "checking" : state;
  const hasQuota = limits?.availability === "available" && generalQuotaWindows(limits).some(window => window.usedPercent !== null);
  const showQuota = ["ready", "unverified"].includes(displayState) || displayState === "unsupported" && hasQuota;
  const update = displayState === "unsupported" && !hasQuota ? "required"
    : showQuota && (updateAvailable || displayState === "unsupported") ? "available" : undefined;
  return { state: displayState, showQuota, update } as const;
}
