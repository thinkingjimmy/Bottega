/**
 * [INPUT]: Depends on the unified CLI certification probe core and Claude's minimal non-credential environment
 * [OUTPUT]: Provides checkClaudeAuth, classifyClaudeAuthFailure claudeRoute / claudeCustomRoute (whether requests go to an endpoint the person configured) and claudeSettingsPath (the file that says so); Only code=1 confirms the unauthenticated projection of the unlogged document
 * [POS]: providers/claude's auth check only repeats what the CLI reports; login instructions are owned by the renderer, not produced here
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createCliAuthCheck } from "../../backends/runtime/cli-auth";
import type { ResolvedRuntime } from "../../backends/types";
import { claudeAdapterEnvironment, selectClaudeProductEnvironment } from "./environment";

/* The keys that send Claude Code's requests somewhere other than Anthropic's own API: a base URL, a cloud switch or resource.
   Account, region and proxy settings route nowhere by themselves. */
const ROUTING_KEY = /BASE_URL$|^CLAUDE_CODE_USE_|^ANTHROPIC_FOUNDRY_RESOURCE$/;
const SETTINGS_BYTES = 1024 * 1024;
const switchedOn = (value: string | undefined) => !/^(0|false|no|off)?$/i.test((value ?? "").trim());
const routed = (source: unknown) =>
  Object.entries(selectClaudeProductEnvironment(source)).some(([key, value]) => ROUTING_KEY.test(key) && switchedOn(value));

/** A custom route (TASK-13 E): the environment Bottega forwards, or the user settings' `env`, routes elsewhere, or an
    `apiKeyHelper` supplies the credential. There `claude auth status` proves nothing about the endpoint. */
export function claudeCustomRoute(env: NodeJS.ProcessEnv, userSettings?: string) {
  if (routed(env)) return true;
  if (!userSettings) return false;
  try {
    const settings = JSON.parse(userSettings) as { env?: unknown; apiKeyHelper?: unknown };
    return routed(settings.env) || (typeof settings.apiKeyHelper === "string" && settings.apiKeyHelper.trim() !== "");
  } catch { return false; }
}

/** The user settings file whose `env` or `apiKeyHelper` can route Claude elsewhere. */
export function claudeSettingsPath(runtime: ResolvedRuntime) {
  return join(claudeAdapterEnvironment(runtime).HOME ?? homedir(), ".claude", "settings.json");
}

export async function claudeRoute(runtime: ResolvedRuntime): Promise<"official" | "custom"> {
  const env = claudeAdapterEnvironment(runtime);
  const settings = await readFile(claudeSettingsPath(runtime), "utf8").catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return undefined;
    throw cause;
  });
  if (settings !== undefined && settings.length > SETTINGS_BYTES) throw new Error("Claude settings too large to read");
  return claudeCustomRoute(env, settings) ? "custom" : "official";
}

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
  /* `claude auth status` reports the account as email + organization; a Console API key reports neither. */
  accountKey: (output) => {
    try {
      const status = JSON.parse(output) as { email?: unknown; orgId?: unknown };
      return typeof status.email === "string" && status.email ? `${status.email.toLowerCase()}\0${typeof status.orgId === "string" ? status.orgId : ""}` : null;
    } catch { return null; }
  },
});

export const checkClaudeAuth = probe.check;
export const classifyClaudeAuthFailure = probe.classifyFailure;
