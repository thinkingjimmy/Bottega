/**
 * [INPUT]: Depends on the Provider descriptor and measured-capability contracts and the Agent-configuration payload.
 * [OUTPUT]: Provides effectiveGuarantees and HostEnforcement: for each guarantee a configuration requests (read-only workspace, no network), whether the target computer enforces it with this Provider and version — `enforced`, `unsupported` or `unverified` — with a typed reason.
 * [POS]: The one answer behind the Read-only badge, "needs attention" and the greyed workflow step (04 §5 role table); computed per target computer because the CLI version and the host's sandbox differ between computers.
 */
import { currentMeasurements, type MeasuredCapability, type MeasurementIdentity, type ProviderDescriptor } from "../contracts/provider";
import type { AgentConfigPayload } from "./payload";

export type GuaranteeState = "enforced" | "unsupported" | "unverified" | "not-requested";
/** `host-sandbox`: Bottega's own sandbox enforces it; `measured`: a probe proved it for this exact CLI; the rest say why not. */
export type GuaranteeReason = "host-sandbox" | "measured" | "provider-cannot" | "host-cannot" | "host-unavailable" | "not-measured" | "not-requested";
export type Guarantee = { state: GuaranteeState; reason: GuaranteeReason };
/**
 * What the target computer's Bottega can enforce by itself, as it publishes it. `readOnlySandbox` lists the Providers its
 * sandbox wraps with a read-only workspace (the RSH-07 branch: Seatbelt for Codex, Kimi and OpenCode; Claude's own
 * sandbox settings written by the host). No host can cut a Provider's tools off the network while its model stays online.
 */
export type HostEnforcement = { readOnlySandbox: readonly string[] };

export function effectiveGuarantees(input: { payload: Pick<AgentConfigPayload, "provider" | "guarantees">; descriptor: ProviderDescriptor | null;
  host: HostEnforcement | null; measured: readonly MeasuredCapability[]; identity: MeasurementIdentity | null }) {
  const { payload, descriptor } = input;
  const proven = (capability: "read-only" | "network-off") => Boolean(input.identity) &&
    currentMeasurements(input.measured.filter(item => item.providerId === payload.provider), input.identity!)
      .some(item => item.capability === capability && item.state === "enforced");
  const workspace: Guarantee = payload.guarantees.workspace !== "read-only" ? { state: "not-requested", reason: "not-requested" }
    /* RSH-07: the host sandbox enforces read-only whatever the CLI can do natively, so it is asked before provider-cannot. */
    : descriptor && input.host?.readOnlySandbox.includes(payload.provider) ? { state: "enforced", reason: "host-sandbox" }
    : !descriptor || descriptor.capabilities["read-only"] === "unsupported" ? { state: "unsupported", reason: "provider-cannot" }
    : !input.host ? { state: "unverified", reason: "host-unavailable" }
    : proven("read-only") ? { state: "enforced", reason: "measured" } : { state: "unverified", reason: "not-measured" };
  /* Only the CLI itself can keep its tools offline with the model online (Claude's domain allowlist); the host cannot. */
  const network: Guarantee = payload.guarantees.network !== "off" ? { state: "not-requested", reason: "not-requested" }
    : !descriptor || descriptor.capabilities["network-off"] === "unsupported" ? { state: "unsupported", reason: "host-cannot" }
    : proven("network-off") ? { state: "enforced", reason: "measured" } : { state: "unverified", reason: "not-measured" };
  return { workspace, network };
}
