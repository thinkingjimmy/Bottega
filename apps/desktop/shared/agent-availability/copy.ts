/**
 * [INPUT]: Depends on the availability state vocabulary and the Provider catalog's unavailable reasons.
 * [OUTPUT]: Provides AVAILABILITY_STATE_KEYS and PROVIDER_UNAVAILABLE_REASON_KEYS, the typed catalog key for every state and reason.
 * [POS]: The one way a surface turns an availability state into copy: a state or reason without a key fails the typecheck, and the
 *        literal keys stay visible to i18n:check (a template key was not).
 */
import type { PROVIDER_UNAVAILABLE_REASONS } from "../providers/catalog-ipc";
import type { AvailabilityState } from "./types";

export const AVAILABILITY_STATE_KEYS = {
  "recent-sign-in": "agentAvailability.state.recent-sign-in",
  connection: "agentAvailability.state.connection",
  service: "agentAvailability.state.service",
  checking: "agentAvailability.state.checking",
  ready: "agentAvailability.state.ready",
  "custom-route": "agentAvailability.state.custom-route",
  unverified: "agentAvailability.state.unverified",
  missing: "agentAvailability.state.missing",
  unsupported: "agentAvailability.state.unsupported",
  "sign-in": "agentAvailability.state.sign-in",
  "cannot-check": "agentAvailability.state.cannot-check",
  "cannot-start": "agentAvailability.state.cannot-start",
  "usage-limit": "agentAvailability.state.usage-limit",
  unavailable: "agentAvailability.state.unavailable",
} as const satisfies { [State in AvailabilityState]: `agentAvailability.state.${State}` };

export const PROVIDER_UNAVAILABLE_REASON_KEYS = {
  "package-disabled": "agentAvailability.unavailableReason.package-disabled",
  "package-removed": "agentAvailability.unavailableReason.package-removed",
  "package-refused": "agentAvailability.unavailableReason.package-refused",
  "trust-refused": "agentAvailability.unavailableReason.trust-refused",
} as const satisfies { [Reason in (typeof PROVIDER_UNAVAILABLE_REASONS)[number]]: `agentAvailability.unavailableReason.${Reason}` };
