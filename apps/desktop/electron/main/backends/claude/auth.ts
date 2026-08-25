/**
 * [INPUT]: Depends on the unified CLI certification probe core and Claude's minimal non-credential environment
 * [OUTPUT]: Provides checkClaudeAuth and classifyClaudeAuthFailure; Only code=1 confirms the unauthenticated projection of the unlogged document
 * [POS]: The backends/claude certification is based on the installation of the backends/claudeJust repeat what the CLI says, and the login instructions go to the renderer directory
 */

import { homedir } from "node:os";
import { createCliAuthCheck } from "../cli-auth";
import { claudeAdapterEnvironment } from "./environment";

function reportsLoggedOut(output: string) {
  try {
    const parsed = JSON.parse(output) as { loggedIn?: unknown };
    if (parsed.loggedIn === false) return true;
  } catch {
    // 旧版 CLI 返回纯文本；继续检查已取证的固定文案。
  }
  return output.toLowerCase().startsWith("invalid api key");
}

const probe = createCliAuthCheck({
  displayName: "Claude",
  args: ["auth", "status"],
  environment: claudeAdapterEnvironment,
  reportsLoggedOut,
  loggedOutReason: (output) => `Claude CLI 报告未登录（${output}）。`,
  redaction: () => ({ home: homedir() }),
});

export const checkClaudeAuth = probe.check;
export const classifyClaudeAuthFailure = probe.classifyFailure;
