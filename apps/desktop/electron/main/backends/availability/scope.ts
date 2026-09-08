/**
 * [INPUT]: Depends on the actual Codex/Claude environment builders and non-secret config file identities.
 * [OUTPUT]: Provides environment and authentication fingerprints, distinguishing provider routing, proxy URLs and proxy bypass host lists.
 * [POS]: Small backend environment seam; unknown user routing never borrows another operation's authentication.
 */
import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { ResolvedRuntime } from "../types";
import { codexEnvironment } from "../codex/environment";
import { claudeAdapterEnvironment, selectClaudeProductEnvironment } from "../claude/environment";

export type ScopePlan = { cwd?: string; model?: string; ignoreUserConfig?: boolean; processEnv?: NodeJS.ProcessEnv; homeDir?: string };
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const connectionEnvironment = /^(https?_proxy|no_proxy|node_extra_ca_certs|ssl_cert_file)$/i;

function routeValues(env: NodeJS.ProcessEnv) {
  const values = selectClaudeProductEnvironment(env);
  for (const [key, value] of Object.entries(values)) {
    if (!value || !/url|proxy/i.test(key) || /^no_proxy$/i.test(key)) continue;
    try {
      const url = new URL(value);
      if (url.username || url.password || url.search || url.hash) return undefined;
    } catch { return undefined; }
  }
  return Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
}

/** File metadata is sufficient to invalidate a claim; it is never authentication proof. */
export async function runtimeEnvironmentIdentity(backend: AgentBackendId, runtime: ResolvedRuntime) {
  const env: NodeJS.ProcessEnv = backend === "codex" ? codexEnvironment(runtime) : backend === "claude" ? claudeAdapterEnvironment(runtime) : {};
  const home = resolve(backend === "codex" ? env.CODEX_HOME ?? join(env.HOME ?? homedir(), ".codex") : env.HOME ?? homedir());
  const paths = backend === "codex" ? [join(home, "config.toml")] : backend === "claude" ? [join(home, ".claude/settings.json"), "/Library/Application Support/ClaudeCode/managed-settings.json"] : [];
  const configs = await Promise.all(paths.map(async (path) => {
    try { const value = await stat(path); return [path, value.ino, value.size, value.mtimeMs]; }
    catch { return [path, "absent"]; }
  }));
  // An unprovable route must still invalidate earlier evidence when its environment changes.
  const routes = Object.entries(selectClaudeProductEnvironment(env)).sort(([left], [right]) => left.localeCompare(right));
  return fingerprint({ backend, home: await realpath(home).catch(() => home), routes, configs });
}

async function absent(path: string) {
  try { await stat(path); return false; }
  catch (cause) { return (cause as NodeJS.ErrnoException).code === "ENOENT"; }
}

export async function executionScope(backend: AgentBackendId, runtime: ResolvedRuntime, identity: string, plan: ScopePlan = {}) {
  if (backend !== "codex" && backend !== "claude") return undefined;
  const env: NodeJS.ProcessEnv = backend === "codex" ? codexEnvironment(runtime, plan.homeDir) : claudeAdapterEnvironment(runtime);
  Object.assign(env, plan.processEnv);
  const homePath = resolve(backend === "codex" ? env.CODEX_HOME ?? join(env.HOME ?? homedir(), ".codex") : env.HOME ?? homedir());
  const home = await realpath(homePath).catch(() => homePath);
  // Existing config can choose credentials or providers. Only a known default route is cross-model equivalent.
  const configs = backend === "codex" ? [join(home, "config.toml")] : [join(home, ".claude", "settings.json"), "/Library/Application Support/ClaudeCode/managed-settings.json"];
  if (!plan.ignoreUserConfig && plan.cwd) configs.push(join(plan.cwd, backend === "codex" ? ".codex/config.toml" : ".claude/settings.json"));
  if (backend === "claude" && plan.cwd && !plan.ignoreUserConfig) configs.push(join(plan.cwd, ".claude/settings.local.json"));
  if (backend === "claude" && !await absent("/Library/Application Support/ClaudeCode/managed-settings.json")) return undefined;
  if (!plan.ignoreUserConfig && !(await Promise.all(configs.map(absent))).every(Boolean)) return undefined;
  const routing = backend === "claude" ? routeValues(env) : [];
  if (!routing) return undefined;
  return fingerprint({ backend, identity, home, routing, config: "official-default",
    ...(routing.some(([key]) => !connectionEnvironment.test(key)) ? { model: plan.model ?? "default" } : {}) });
}
