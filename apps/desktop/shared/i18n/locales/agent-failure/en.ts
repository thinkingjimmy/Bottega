/**
 * [INPUT]: Depends on no runtime modules; defines the structural baseline for Agent failure copy
 * [OUTPUT]: Provides English titles, explanations, recovery instructions, and diagnostic disclosure labels
 * [POS]: English authority for provider-neutral Agent failure presentation
 */

export const agentFailureEn = {
  technicalDetails: "Technical details",
  copyDetails: "Copy technical details",
  copiedDetails: "Technical details copied",
  code: {
    "auth-required": {
      title: "{{backend}} needs you to sign in again",
      explanation: "Your sign-in has expired or was not completed.",
      resolution: "Run `{{command}}` in a terminal, finish signing in, then return to Bottega and try again.",
    },
    "rate-limited": {
      title: "{{backend}} is receiving too many requests",
      explanation: "The provider has temporarily slowed down new requests.",
      resolution: "Wait a moment and try again. If this keeps happening, check your network and the provider status page.",
    },
    "quota-exhausted": {
      title: "{{backend}} has no available usage right now",
      explanation: "The account has reached a usage limit or has no remaining balance.",
      resolution: "Check the provider plan, usage, and billing, or wait until the shown reset time before trying again.",
    },
    "context-exhausted": {
      title: "This conversation is too large to continue",
      explanation: "The Agent reached the context or session budget for this conversation.",
      resolution: "Start a new Chat and send a shorter request with fewer files or pasted details.",
    },
    "connection-lost": {
      title: "The connection to {{backend}} was interrupted",
      explanation: "Bottega could not keep a stable connection to the Agent.",
      resolution: "Check your internet connection, VPN, and proxy, then try again when the connection is stable.",
    },
    "request-rejected": {
      title: "{{backend}} could not use this request",
      explanation: "The selected model, configuration, or request was not accepted.",
      resolution: "Choose an available model, review the Agent settings, and try a shorter or simpler request.",
    },
    "service-unavailable": {
      title: "{{backend}} is temporarily unavailable",
      explanation: "The Agent or model provider reported a temporary service problem.",
      resolution: "Try again later. If it keeps happening, update the Agent and copy the technical details for support.",
    },
    "runtime-unavailable": {
      title: "{{backend}} could not start",
      explanation: "The local Agent is missing, outdated, or did not pass its startup check.",
      resolution: "Open Agent settings, install or update {{backend}}, then check it again.",
    },
    unknown: {
      title: "{{backend}} could not finish this request",
      explanation: "The Agent reported a problem that Bottega could not classify safely.",
      resolution: "Try once more. If it happens again, expand and copy the technical details for support.",
    },
  },
  notice: {
    title: "{{backend}} sent a notice",
    explanation: "This notice comes from {{backend}} itself, not from Bottega. This reply is not affected.",
  },
};
