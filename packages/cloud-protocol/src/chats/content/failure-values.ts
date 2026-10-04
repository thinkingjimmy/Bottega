/**
 * [INPUT]: Depends on nothing at runtime (no zod); ProductFailure and its safe details are type-only from failure.ts.
 * [OUTPUT]: Provides AGENT_RUNTIME_FAILURE_CODES and AgentRuntimeFailureCode, FAILURE_DIAGNOSTIC_CHAR_LIMIT, noFailureDetails, diagnosticFailureDetails (bounded, redacted) and agentRuntimeFailure (a known code, else it throws). Names disabled App admission failures.
 * [POS]: The zod-free leaf of the product failure contract, so code that only builds Agent failures (a Provider's bridge module) carries no schema library; failure.ts re-exports all of it, and the strict schema still validates every failure where it crosses IPC or is stored.
 */
import type { ProductFailure, ProductFailureSafeDetails } from "./failure";

export const AGENT_RUNTIME_FAILURE_CODES = [
  "auth-required",
  "rate-limited",
  "quota-exhausted",
  "context-exhausted",
  "connection-lost",
  "request-rejected",
  "mode-unsupported",
  "app-disabled",
  "service-unavailable",
  "runtime-unavailable",
  /* P13 pre-release addition (held-recovery fix): a launch that waited its bound for startup recovery. `startup-recovery-pending`: the
     profile is still finishing startup checks; `earlier-process-holding`: an earlier Agent process is still finishing. */
  "startup-recovery-pending",
  "earlier-process-holding",
  "unknown",
] as const;

export type AgentRuntimeFailureCode = (typeof AGENT_RUNTIME_FAILURE_CODES)[number];

export const FAILURE_DIAGNOSTIC_CHAR_LIMIT = 2_048;

export const noFailureDetails = (): ProductFailureSafeDetails => ({ version: 1, kind: "none" });

// Transports redact current secrets first; this boundary also masks common credentials and user directories.
export function diagnosticFailureDetails(value: unknown): ProductFailureSafeDetails {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  const message = raw
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|sess|token)-[A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/…")
    .replace(/\b[A-Z]:\\Users\\[^\\\s]+/gi, "C:\\Users\\…")
    .trim()
    .slice(0, FAILURE_DIAGNOSTIC_CHAR_LIMIT);
  return message ? { version: 1, kind: "diagnostic", message } : noFailureDetails();
}

/** An Agent failure; an unknown code is refused here, and the whole value is validated by the strict schema where it crosses a boundary. */
export const agentRuntimeFailure = (code: AgentRuntimeFailureCode, safeDetails: ProductFailureSafeDetails = noFailureDetails()): ProductFailure => {
  if (!(AGENT_RUNTIME_FAILURE_CODES as readonly string[]).includes(code)) throw new Error(`unknown agent-runtime failure code: ${String(code)}`);
  return { domain: "agent-runtime", code, safeDetails };
};
