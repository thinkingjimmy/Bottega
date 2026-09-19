/**
 * [INPUT]: Depends on quota DTOs and timing constants.
 * [OUTPUT]: Projects all general windows, tightest remaining percentages, reset status, staleness and stable order.
 * [POS]: Pure quota rules shared by scheduling and both renderer surfaces.
 */
export { remainingPercent, quotaWindowExpired, quotaStale, currentRemaining, sortQuotaPools, generalQuotaWindows, generalRemaining, emptyAgentLimits } from "@ai-chat/cloud-protocol/remote/quota";
