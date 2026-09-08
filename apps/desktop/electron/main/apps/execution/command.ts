/**
 * [INPUT]: Depends on admitted commands, source-local files, AppConfigStore, Host data and ordered runtime discovery
 * [OUTPUT]: Provides argv-only execution plans with script digest, cwd and environment boundaries
 * [POS]: Sole interpreter consumed by install, repair and server; execution custody stays with each caller
 */

import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { AppCommand, AppCommandTarget } from "../../../../shared/apps-execution";
import { environmentValue, findExecutable } from "../../custody/executable-path";
import { probeRuntimeCandidatesAsync, sanitizedProcessEnvironment } from "../../backends/runtime-probe";
import { AppConfigStore } from "../share/app-config-store";
import { isContained } from "../support";
import { structuredAppCommandSchema } from "./schema";
import { readCommandSource } from "./source-file";
import { resolvePlatformCapabilities } from "../../../../shared/platform-capabilities";

type AppCommandContext = {
  root: string; env?: NodeJS.ProcessEnv; config?: Readonly<Record<string, string>>;
  host?: Partial<Record<"PORT" | "HOST" | "APP_DATA_DIR", string>>;
  signal?: AbortSignal;
};

export async function resolveConfiguredAppCommand(
  command: AppCommand, context: Omit<AppCommandContext, "config"> & { userData: string; appId: string }
) {
  const { values } = await new AppConfigStore(context.userData).read(context.appId);
  return resolveAppCommand(command, { ...context, config: values });
}

export async function resolveAppCommand(command: AppCommand, context: AppCommandContext) {
  context.signal?.throwIfAborted();
  const env: NodeJS.ProcessEnv = { ...sanitizedProcessEnvironment(), ...context.env };
  if (typeof command === "string") {
    if (process.platform !== "darwin") throw commandError("APP_COMMAND_MIGRATION_REQUIRED");
    const text = bindLegacy(command, context.host ?? {});
    return { executable: "/bin/zsh", args: ["-lc", `unset CODEX_HOME CODEX_API_KEY OPENAI_API_KEY OPENAI_ORG_ID OPENAI_PROJECT_ID\n${text}`], cwd: context.root, env };
  }
  const parsed = structuredAppCommandSchema.parse(command);
  /* 结构化命令需要已验证的原生受控执行合同。tier 就是这份合同的产品级判据，
     不借某个具体 capability 的名字来表达它。 */
  if (resolvePlatformCapabilities(process.platform).tier !== "first-class") throw commandError("APP_COMMAND_NATIVE_RUNTIME_REQUIRED");
  const target = "platforms" in parsed.target ? parsed.target.platforms[platform()] : parsed.target;
  const root = await realpath(context.root);
  const cwd = await containedDirectory(root, parsed.cwd);
  const launch = await runtimeTarget(target, root, env, context.signal);
  for (const [key, reference] of Object.entries(parsed.env)) {
    const value = "config" in reference ? context.config?.[reference.config] : context.host?.[reference.host];
    if (value === undefined || value.includes("\0")) throw commandError("APP_COMMAND_ENV_UNAVAILABLE");
    env[key] = value;
  }
  return { ...launch, args: [...launch.args, ...parsed.argv.map((arg) => bindArgument(arg, context.host ?? {}))], cwd,
    env: { ...env, ...(launch.executable === process.execPath ? { ELECTRON_RUN_AS_NODE: "1" } : {}) } };
}

async function runtimeTarget(target: AppCommandTarget, root: string, env: NodeJS.ProcessEnv, signal?: AbortSignal) {
  if (target.script) {
    const { path: script, bytes } = await readCommandSource(root, target.script.path, 1024 * 1024);
    if (bytes.length > 1024 * 1024 || `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== target.script.sha256) throw commandError("APP_COMMAND_SCRIPT_CHANGED");
    const executable = target.runtime === "node" ? process.execPath : await commandRuntime(target.runtime, env, signal);
    if (!executable) throw commandError("APP_COMMAND_RUNTIME_MISSING");
    const flags = target.runtime === "pwsh" ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-File"] : target.runtime === "bash" ? ["--noprofile", "--norc", "--"] : target.runtime === "zsh" ? ["-f", "--"] : [];
    return { executable, args: [...flags, script] };
  }
  if (process.platform === "win32") return windowsPackageManager(target.runtime, env);
  const executable = await commandRuntime(target.runtime, env, signal);
  if (!executable) throw commandError("APP_COMMAND_RUNTIME_MISSING");
  return { executable, args: [] as string[] };
}

async function commandRuntime(command: string, env: NodeJS.ProcessEnv, signal?: AbortSignal) {
  const direct = await findExecutable(command, env, signal);
  if (direct) return direct;
  const [runtime] = await probeRuntimeCandidatesAsync({ command, signal });
  if (runtime) env.PATH = runtime.path;
  return runtime?.executable;
}

/** cwd 只能是 App 根内的真实目录：不许链接、不许越界。文件一律走 readCommandSource。 */
async function containedDirectory(root: string, relative: string) {
  const path = resolve(root, relative);
  const actual = await realpath(path);
  const info = await lstat(path);
  if (!isContained(root, actual) || actual !== path || info.isSymbolicLink() || !info.isDirectory()) throw commandError("APP_COMMAND_PATH_INVALID");
  return actual;
}

function bindArgument(value: string, host: AppCommandContext["host"]) {
  return value.replace(/\{(PORT|HOST|APP_DATA_DIR)\}/g, (_, key: "PORT" | "HOST" | "APP_DATA_DIR") => {
    const data = host?.[key];
    if (data === undefined || data.includes("\0")) throw commandError("APP_COMMAND_ENV_UNAVAILABLE");
    return data;
  });
}

function bindLegacy(value: string, host: NonNullable<AppCommandContext["host"]>) {
  if (host.PORT && !/^\d{1,5}$/.test(host.PORT)) throw commandError("APP_COMMAND_ENV_UNAVAILABLE");
  if (host.HOST && host.HOST !== "127.0.0.1") throw commandError("APP_COMMAND_ENV_UNAVAILABLE");
  return value.replaceAll("{PORT}", host.PORT ?? "{PORT}").replaceAll("{HOST}", host.HOST ?? "{HOST}");
}

export const appCommandLabel = (value: AppCommand) => typeof value === "string" ? value.slice(0, 80) : "App command v1";
export function commandUsesPort(value: AppCommand) {
  return typeof value === "string" ? value.includes("{PORT}") : value.argv.some((arg) => arg.includes("{PORT}")) || Object.values(value.env).some((ref) => "host" in ref && ref.host === "PORT");
}
function platform(): "darwin" | "win32" | "linux" {
  if (process.platform === "darwin" || process.platform === "win32" || process.platform === "linux") return process.platform;
  throw commandError("APP_COMMAND_RUNTIME_MISSING");
}
function commandError(code: string) { return Object.assign(new Error(code), { code }); }

async function windowsPackageManager(runtime: string, env: NodeJS.ProcessEnv) {
  const entries: Record<string, string> = { npm: "npm/bin/npm-cli.js", pnpm: "pnpm/bin/pnpm.cjs", yarn: "yarn/bin/yarn.js" };
  const entry = entries[runtime];
  if (!entry) throw commandError("APP_COMMAND_RUNTIME_MISSING");
  const node = await findExecutable("node", env);
  const appData = environmentValue(env, "APPDATA");
  const roots = [...(node ? [dirname(node)] : []), ...(appData ? [join(appData, "npm")] : [])];
  for (const root of roots) {
    const script = join(root, "node_modules", entry);
    const info = await lstat(script).catch(() => null);
    if (info?.isFile() && !info.isSymbolicLink()) return { executable: process.execPath, args: [await realpath(script)] };
  }
  throw commandError("APP_COMMAND_RUNTIME_MISSING");
}
