/**
 * [INPUT]: Depends on the shared CLI auth-check core and codexEnvironment's minimal non-credential environment
 * [OUTPUT]: Provides checkCodexAuth and classifyCodexAuthFailure; only the exact `Not logged in` CLI message is mapped to the unauthenticated state
 * [POS]: backends/codex's auth check only repeats what the CLI reports; login instructions are owned by the renderer, not produced here
 */

import { codexEnvironment } from "./environment";
import { acpDiagnosticRedactionOptions } from "../acp/trace";
import { createCliAuthCheck } from "../cli-auth";

const probe = createCliAuthCheck({
  displayName: "Codex",
  args: ["login", "status"],
  environment: codexEnvironment,
  /* 真机取证：`codex login status` 的未登录报文走 stderr。 */
  outputStreams: "stderr-first",
  reportsLoggedOut: (value) => /^Not logged in\.?$/i.test(value.trim()),
  loggedOutReason: () => "Codex CLI 明确报告未登录。",
  redaction: acpDiagnosticRedactionOptions,
});

export const checkCodexAuth = probe.check;
export const classifyCodexAuthFailure = probe.classifyFailure;
