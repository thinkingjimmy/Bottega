/**
 * [INPUT]: Depends on Node crypto and AppManifest's three-field server contract, time and status provided by the receiving caller
 * [OUTPUT]: Provides token/ack, awakens judgment, canonical, covenant fingerprint, deck, token barrel, withdrawal and submersion of pure functions
 * [POS]: The events driven server of apps/runtime is pure kernel, no files read, no watcher created, no timer held
 */

import { createHash } from "node:crypto";
import type { ServerAppManifest } from "../../../../shared/apps-ipc";

export const SERVE_ACK_VERSION = 1;
export const SERVE_DEBOUNCE_MS = 500;
export const SERVE_MAX_WAIT_MS = 2_000;
export const SERVE_BUCKET_CAPACITY = 3;
export const SERVE_BUCKET_REFILL_MS = 60_000;
export const SERVE_BUCKET_ESCALATION_MS = 5 * 60_000;
export const SERVE_QUIET_RESET_MS = 60_000;
export const SERVE_RETRY_MIN_MS = 5_000;
export const SERVE_RETRY_MAX_MS = 5 * 60_000;

export type ServeToken = {
  sha256: string;
  size: number;
};

export type ServeAck = ServeToken & {
  version: typeof SERVE_ACK_VERSION;
  watchPath: string;
  contractFingerprint: string;
};

export type ServeContract = Pick<
  ServerAppManifest,
  "serveTrigger" | "serveAgentPrompt" | "agentRequirements"
>;

export type DebounceState = {
  firstAt: number;
  lastAt: number;
};

export type TokenBucketState = {
  tokens: number;
  refilledAt: number;
  lastChangeAt: number;
  saturatedSince: number | null;
};

export type RetryState = {
  failures: number;
  retryAt: number;
};

export type TurnReduction = {
  retry: RetryState;
  shouldAck: boolean;
  shouldChase: boolean;
};

export function decideWake(
  token: ServeToken | null,
  ack: ServeAck | null,
  watchPath: string,
  contractFingerprint: string
) {
  if (!token) return "skip" as const;
  return isAckValid(ack, token, watchPath, contractFingerprint)
    ? ("skip" as const)
    : ("wake" as const);
}

export function isAckValid(
  ack: ServeAck | null,
  token: ServeToken,
  watchPath: string,
  contractFingerprint: string
) {
  return Boolean(
    ack &&
      ack.version === SERVE_ACK_VERSION &&
      ack.watchPath === watchPath &&
      ack.sha256 === token.sha256 &&
      ack.size === token.size &&
      ack.contractFingerprint === contractFingerprint
  );
}

export function contractFingerprint(
  contract: ServeContract,
  deliveryFingerprint: string
) {
  return createHash("sha256")
    .update(canonicalJson(contract))
    .update("\0")
    .update(deliveryFingerprint)
    .digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function noteDebounce(
  state: DebounceState | null,
  now: number
): DebounceState {
  return state ? { ...state, lastAt: now } : { firstAt: now, lastAt: now };
}

export function debounceDueAt(state: DebounceState) {
  return Math.min(
    state.lastAt + SERVE_DEBOUNCE_MS,
    state.firstAt + SERVE_MAX_WAIT_MS
  );
}

export function createTokenBucket(now: number): TokenBucketState {
  return {
    tokens: SERVE_BUCKET_CAPACITY,
    refilledAt: now,
    lastChangeAt: now,
    saturatedSince: null,
  };
}

export function observeTokenBucket(
  state: TokenBucketState,
  now: number,
  changed: boolean
): TokenBucketState {
  if (!changed && now - state.lastChangeAt >= SERVE_QUIET_RESET_MS) {
    return createTokenBucket(now);
  }
  const elapsed = Math.max(0, now - state.refilledAt);
  const refill = Math.floor(elapsed / SERVE_BUCKET_REFILL_MS);
  return {
    ...state,
    tokens: Math.min(SERVE_BUCKET_CAPACITY, state.tokens + refill),
    refilledAt: state.refilledAt + refill * SERVE_BUCKET_REFILL_MS,
    lastChangeAt: changed ? now : state.lastChangeAt,
  };
}

export function consumeTokenBucket(
  state: TokenBucketState,
  now: number
): {
  state: TokenBucketState;
  allowed: boolean;
  retryAt: number;
  escalated: boolean;
} {
  const current = observeTokenBucket(state, now, true);
  if (current.tokens >= 1) {
    return {
      state: {
        ...current,
        tokens: current.tokens - 1,
        saturatedSince: current.saturatedSince,
      },
      allowed: true,
      retryAt: now,
      escalated: false,
    };
  }
  const saturatedSince = current.saturatedSince ?? now;
  return {
    state: { ...current, saturatedSince },
    allowed: false,
    retryAt: current.refilledAt + SERVE_BUCKET_REFILL_MS,
    escalated: now - saturatedSince >= SERVE_BUCKET_ESCALATION_MS,
  };
}

export function createRetryState(): RetryState {
  return { failures: 0, retryAt: 0 };
}

export function failRetry(state: RetryState, now: number): RetryState {
  const delay = Math.min(
    SERVE_RETRY_MAX_MS,
    SERVE_RETRY_MIN_MS * 2 ** state.failures
  );
  return { failures: state.failures + 1, retryAt: now + delay };
}

export function reduceTurnResult(
  state: RetryState,
  now: number,
  result: "success" | "failure"
): TurnReduction {
  return result === "success"
    ? { retry: createRetryState(), shouldAck: true, shouldChase: true }
    : { retry: failRetry(state, now), shouldAck: false, shouldChase: false };
}
