/**
 * [INPUT]: Depends on the adapter steer outcome type and the shared asError helper
 * [OUTPUT]: Provides normalizeSteerOutcome, requestAcpSteering with a timeout, and SteeringOperationGate to serialize in-flight steer requests
 * [POS]: ACP turn transport's steering core; AcpTurn only owns session lifecycle and call sequencing
 */

import { asError } from "../../../../ipc/errors";
import type { AdapterSteerOutcome } from "../../../../backends/types";

const STEER_TIMEOUT_MS = 10_000;

export function normalizeSteerOutcome(value: unknown): AdapterSteerOutcome {
  const outcome =
    value && typeof value === "object"
      ? (value as { outcome?: unknown }).outcome
      : undefined;
  if (outcome === "injected") return { outcome: "injected" };
  if (outcome === "promptRequired") {
    return { outcome: "unconsumed", reason: "promptRequired" };
  }
  if (outcome === "startedNewTurn" || outcome === "failed") {
    return {
      outcome: "ambiguous",
      reason:
        outcome === "startedNewTurn"
          ? "adapter started a detached turn"
          : "adapter could not prove whether steering was consumed",
    };
  }
  return {
    outcome: "ambiguous",
    reason: `unknown steering outcome: ${String(outcome)}`,
  };
}

export async function requestAcpSteering(
  send: () => Promise<unknown>,
  interrupt: () => void
): Promise<AdapterSteerOutcome> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutResult = new Promise<AdapterSteerOutcome>((resolve) => {
    timeout = setTimeout(() => {
      interrupt();
      resolve({ outcome: "ambiguous", reason: "steering request timed out" });
    }, STEER_TIMEOUT_MS);
  });
  const response = send()
    .then((value) => {
      const outcome = normalizeSteerOutcome(value);
      if (outcome.outcome === "ambiguous") interrupt();
      return outcome;
    })
    .catch((cause): AdapterSteerOutcome => {
      interrupt();
      return { outcome: "ambiguous", reason: asError(cause).message };
    });
  return Promise.race([response, timeoutResult]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export class SteeringOperationGate {
  private readonly operations = new Set<Promise<AdapterSteerOutcome>>();

  async run(operation: Promise<AdapterSteerOutcome>) {
    this.operations.add(operation);
    try {
      return await operation;
    } finally {
      this.operations.delete(operation);
    }
  }

  async wait() {
    if (this.operations.size) {
      await Promise.allSettled([...this.operations]);
    }
  }
}
