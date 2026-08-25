/**
 * [INPUT]: Depends on the Unified CLI Certification Core and Codex Minimum Non-Documented Environment
 * [OUTPUT]: Provides checkCodexAuth and classifyCodexAuthFailure; Just be precise `Not logged in` The evidence is mapped as unregistered
 * [POS]: The following are the official documents of the European Union and the European Union: Just repeat what the CLI says, and the login instructions go to the renderer directory
 */

import { codexEnvironment } from "../../codex-runtime";
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
