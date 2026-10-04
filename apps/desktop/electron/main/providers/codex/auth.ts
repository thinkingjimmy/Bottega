/**
 * [INPUT]: Depends on the shared CLI auth-check core and codexEnvironment's minimal non-credential environment
 * [OUTPUT]: Provides checkCodexAuth, classifyCodexAuthFailure and codexRoute / codexModelProvider (the provider its config routes to, profiles included); only the exact `Not logged in` CLI message is mapped to the unauthenticated state; a ChatGPT sign-in's account id (from Codex's own auth file) feeds the account fingerprint
 * [POS]: providers/codex's auth check only repeats what the CLI reports; login instructions are owned by the renderer, not produced here
 */

import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import type { ResolvedRuntime } from "../../backends/types";
import { homedir } from "node:os";
import { join } from "node:path";
import { codexEnvironment } from "./environment";
import { acpDiagnosticRedactionOptions } from "../../backends/acp/trace";
import { createCliAuthCheck } from "../../backends/runtime/cli-auth";

const ACCOUNT_FILE_BYTES = 64 * 1024;
/* Only `tokens.account_id` is taken from Codex's own auth file: a ChatGPT sign-in names its account there, an API key does not.
   No-follow, bounded, read-only; no token or key is kept. */
async function codexAccountId(env: NodeJS.ProcessEnv) {
  const file = await open(join(env.CODEX_HOME ?? join(env.HOME ?? homedir(), ".codex"), "auth.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const bytes = Buffer.alloc(ACCOUNT_FILE_BYTES + 1), { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > ACCOUNT_FILE_BYTES) return null;
    const auth = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")) as { tokens?: { account_id?: unknown } };
    bytes.fill(0);
    return typeof auth.tokens?.account_id === "string" && auth.tokens.account_id ? auth.tokens.account_id : null;
  } finally { await file.close(); }
}

/** The provider Codex sends requests to: a top-level `model_provider`, or the one in the table of the profile a top-level
    `profile` selects (a line scan, no TOML dependency). undefined is Codex's own default. */
export function codexModelProvider(config: string) {
  let table: string | null = null;
  const top: Record<string, string> = {}, profiles = new Map<string, Record<string, string>>();
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[\s*([^\]]+?)\s*\](?:\s*#.*)?$/.exec(line);
    if (header) { table = header[1]!.replaceAll('"', "").replaceAll("'", ""); continue; }
    const entry = /^(model_provider|profile)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(line);
    if (!entry) continue;
    const value = entry[2] ?? entry[3] ?? "";
    if (table === null) top[entry[1]!] = value;
    else if (table.startsWith("profiles.")) {
      const name = table.slice("profiles.".length);
      profiles.set(name, { ...profiles.get(name), [entry[1]!]: value });
    }
  }
  return (top.profile !== undefined ? profiles.get(top.profile)?.model_provider : undefined) ?? top.model_provider;
}

/** A custom route (TASK-13 E): the config in the CODEX_HOME the turn uses names a provider other than `openai`. */
export async function codexRoute(runtime: ResolvedRuntime): Promise<"official" | "custom"> {
  const env = codexEnvironment(runtime);
  const config = await readFile(join(env.CODEX_HOME ?? join(env.HOME ?? homedir(), ".codex"), "config.toml"), "utf8").catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return "";
    throw cause;
  });
  const provider = codexModelProvider(config);
  return provider !== undefined && provider !== "openai" ? "custom" : "official";
}

const probe = createCliAuthCheck({
  displayName: "Codex",
  args: ["login", "status"],
  environment: codexEnvironment,
  /* 真机取证：`codex login status` 的未登录报文走 stderr。 */
  outputStreams: "stderr-first",
  reportsLoggedOut: (value) => /^Not logged in\.?$/i.test(value.trim()),
  loggedOutReason: () => "Codex CLI 明确报告未登录。",
  redaction: acpDiagnosticRedactionOptions,
  accountKey: (_output, env) => codexAccountId(env),
});

export const checkCodexAuth = probe.check;
export const classifyCodexAuthFailure = probe.classifyFailure;
