/**
 * [INPUT]: Depends on the shared APP_PROBE_FAILURE_CODES and a failed git invocation's stderr, exit facts and working-directory presence
 * [OUTPUT]: Provides classifyGitFailure (one typed code per failure class) and probeFailure (an Error whose message is `CODE: English detail`)
 * [POS]: share/package's failure vocabulary for the repository probe; repo-probe throws only these, and the Add App dialog maps each code to copy
 */

import type { AppProbeFailureCode } from "../../../../../shared/ipc/apps/apps-install-ipc";

export type GitFailureFacts = {
  stderr: string;
  /** Whether the working directory still existed when git failed. */
  cwdExists: boolean;
  /** execFile's timeout kill (SIGTERM) or another signal. */
  killed: boolean;
  signal: string | null;
  code?: string;
};

const CLASSES: ReadonlyArray<readonly [AppProbeFailureCode, RegExp]> = [
  ["APP_PROBE_INTERRUPTED", /Unable to read current working directory/i],
  ["APP_REPOSITORY_AUTH_REQUIRED", /Authentication failed|could not read (?:Username|Password)|terminal prompts disabled|Permission denied \(publickey|returned error: 40[13]\b|Invalid username or password/i],
  ["APP_REPOSITORY_NOT_FOUND", /Repository not found|repository '[^']*' not found|does not appear to be a git repository|returned error: 404\b|does not exist/i],
  ["APP_REF_UNAVAILABLE", /not our ref|couldn.t find remote ref|unadvertised object|does not allow request|Remote branch .* not found|invalid reference/i],
  ["APP_REPOSITORY_UNREACHABLE", /Could not resolve host|Failed to connect|Couldn.t connect|Connection (?:timed out|refused|reset)|Network is unreachable|Operation timed out|SSL|TLS|unable to access|early EOF|remote end hung up/i],
];

export function classifyGitFailure(facts: GitFailureFacts): AppProbeFailureCode {
  // Staging removed under a running git: spawn reports ENOENT for the missing cwd.
  if (!facts.cwdExists) return "APP_PROBE_INTERRUPTED";
  for (const [code, pattern] of CLASSES) if (pattern.test(facts.stderr)) return code;
  // execFile's own timeout sends SIGTERM: a network that never answered. Any other signal stopped the check from outside.
  if (facts.killed && facts.signal === "SIGTERM") return "APP_REPOSITORY_UNREACHABLE";
  if (facts.signal) return "APP_PROBE_INTERRUPTED";
  return "APP_REPOSITORY_PROBE_FAILED";
}

const DETAIL: Record<AppProbeFailureCode, string> = {
  APP_REPOSITORY_UNREACHABLE: "the repository host could not be reached",
  APP_REPOSITORY_AUTH_REQUIRED: "the repository host asked for a sign-in",
  APP_REPOSITORY_NOT_FOUND: "the repository does not exist or is not visible",
  APP_REF_UNAVAILABLE: "the pinned version is no longer in the repository",
  APP_PROBE_INTERRUPTED: "the check was interrupted",
  APP_PACKAGE_INVALID: "the repository is not an installable App package",
  APP_REPOSITORY_PROBE_FAILED: "the repository check failed",
};

/** The only errors the probe shows the person; `why` is for diagnostics and never becomes the message. */
export function probeFailure(code: AppProbeFailureCode, why?: string) {
  if (why) console.warn(`[apps] repository check ${code}: ${why.slice(0, 2_000)}`);
  return Object.assign(new Error(`${code}: ${DETAIL[code]}`), { code });
}
