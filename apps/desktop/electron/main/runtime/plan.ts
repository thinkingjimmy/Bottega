/**
 * [INPUT]: Depends on the runtime model (LaunchRefused, entry and package names).
 * [OUTPUT]: Provides NodeProgram, NodeLaunchRequest, NodeLaunch, BLANKED_NODE_ENVIRONMENT (the stripped Node variables as empty values, for a spec another process launches) and planNodeLaunch: the bundled Node with `--disable-proto=throw` (Bottega's entries and adapters; not App scripts, which are isolated from Bottega), then the program, then its own arguments; the environment is the caller's allowlist with every Node and Electron runtime variable removed; Bottega's entries and adapters never take inspect, --require / --import or eval arguments.
 * [POS]: The runtime port's command-line owner (TASK-35 §2.2). Supervision (custody, sandboxes, registries) consumes the NodeLaunch; this file decides only what runs.
 */
import { LaunchRefused, type NodeEntry, type NodePackage } from "./model";

export type NodeProgram =
  | { kind: "entry"; entry: NodeEntry }
  | { kind: "package"; package: NodePackage }
  /** An App's `runtime:node` script: the App's own trust (its install), and its own arguments. */
  | { kind: "app"; script: string };
export type NodeLaunchRequest = { program: NodeProgram; args: readonly string[]; env: Readonly<Record<string, string | undefined>>; cwd: string };
export type NodeLaunch = { command: string; args: string[]; env: Record<string, string>; cwd: string };

/* Plain Node reads these whatever Electron's fuses say, so the port, not the fuses, keeps them out of layer 2. */
/* One enumerated list, stated verbatim in task-35 §2.2: every variable that makes Node load code or a file from outside the program,
   or weakens TLS. Behaviour-only ones (NODE_USE_ENV_PROXY, NODE_NO_WARNINGS, ...) pass, so a user's network setup keeps working. */
const NODE_VARIABLES = ["NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "NODE_DEBUG", "NODE_DEBUG_NATIVE", "NODE_V8_COVERAGE",
  "NODE_REPL_EXTERNAL_MODULE", "NODE_TEST_CONTEXT", "NODE_PENDING_DEPRECATION", "NODE_PRESERVE_SYMLINKS", "NODE_REDIRECT_WARNINGS",
  "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_COMPILE_CACHE", "NODE_ICU_DATA"] as const;
const STRIPPED = new Set<string>([...NODE_VARIABLES, "ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE", "ELECTRON_ENABLE_LOGGING"]);
/* For a program another process starts (the builtin MCP server a CLI launches with whatever environment it has): the same variables,
   blanked in the spec, since an empty value overrides what that process would pass through and Node ignores it. */
export const BLANKED_NODE_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(NODE_VARIABLES.map(name => [name, ""])));
const REFUSED: readonly [RegExp, "inspect-flag" | "require-flag" | "eval-flag"][] = [
  [/^--inspect(?:-brk|-port|-wait)?(?:=|$)/, "inspect-flag"], [/^--debug(?:-brk|-port)?(?:=|$)/, "inspect-flag"],
  [/^(?:-r|--require|--import|--loader|--experimental-loader)(?:=|$)/, "require-flag"],
  [/^(?:-e|--eval|-p|--print)(?:=|$)/, "eval-flag"],
];

export function planNodeLaunch(node: string, programPath: string, request: NodeLaunchRequest): NodeLaunch {
  /* Our entries and adapters take none of these; an App's script receives its arguments after its path, where Node never reads them. */
  if (request.program.kind !== "app") {
    for (const arg of request.args) {
      const hit = REFUSED.find(([pattern]) => pattern.test(arg));
      if (hit) throw new LaunchRefused(hit[1], `A runtime launch may not carry ${arg}.`);
    }
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.env)) if (value !== undefined && !STRIPPED.has(key)) env[key] = value;
  /* --disable-proto=throw protects a process from its own inputs: Bottega's entries and adapters parse data from outside, so they get it.
     An App is isolated from Bottega, so forcing it buys Bottega nothing and breaks third-party code that uses __proto__ (ruling
     2026-09-26); the environment guards above apply to Apps all the same. */
  const hardening = request.program.kind === "app" ? [] : ["--disable-proto=throw"];
  return { command: node, args: [...hardening, programPath, ...request.args], env, cwd: request.cwd };
}
