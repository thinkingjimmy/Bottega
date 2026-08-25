/**
 * [INPUT]: The Boolean Facts of the two pending participants in the Accepts Extension and Base GUI
 * [OUTPUT]: Provides pendingConsentState to distinguish between a merger and a pendingConsentState; Concentrated decision headings, descriptions and two types of editable inputs
 * [POS]: The generation consent of components/apps is a pure state machine; UI only rendered results without multiple bullet values to be half-finished
 */

export type PendingConsentState = Readonly<{
  kind: "combined" | "extension" | "base-gui" | "ready";
  title: string;
  description: string;
  resolveExtension: boolean;
  resolveBaseGui: boolean;
}>;

const CONSENT_STATES = [
  consentState("ready", "ready", false, false),
  consentState("base-gui", "pending", false, true),
  consentState("extension", "extensionPending", true, false),
  consentState("combined", "combinedPending", true, true),
] as const satisfies readonly PendingConsentState[];

export function pendingConsentState(
  awaitingExtension: boolean,
  awaitingBaseGui: boolean
): PendingConsentState {
  const state = (awaitingExtension ? 2 : 0) | (awaitingBaseGui ? 1 : 0);
  return CONSENT_STATES[state]!;
}

function consentState(
  kind: PendingConsentState["kind"],
  prefix: string,
  resolveExtension: boolean,
  resolveBaseGui: boolean
): PendingConsentState {
  return {
    kind,
    title: `apps.baseGuiConsent.${prefix}Title`,
    description: `apps.baseGuiConsent.${prefix}Description`,
    resolveExtension,
    resolveBaseGui,
  };
}
