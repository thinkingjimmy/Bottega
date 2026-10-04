/**
 * [INPUT]: Depends on explicit platform, PATH/PATHEXT values and filesystem executable facts
 * [OUTPUT]: Provides validated executable entry paths preserving symlinks for spawn-time identity checks, and platform environment projection
 * [POS]: Shared runtime discovery leaf; finding a path supplies no execution or sandbox authority
 */

import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { win32, posix } from "node:path";

export function environmentValue(env: NodeJS.ProcessEnv, name: string, platform = process.platform) {
  if (platform !== "win32") return env[name];
  const key = Object.keys(env).find((key) => key.toUpperCase() === name.toUpperCase());
  return key ? env[key] : undefined;
}

export function executableCandidates(command: string, env: NodeJS.ProcessEnv, platform = process.platform) {
  const paths = platform === "win32" ? win32 : posix;
  if (platform === "win32" && paths.extname(command) && !/\.(exe|com)$/i.test(command)) return [];
  const extensions = platform === "win32" && !paths.extname(command)
    ? (environmentValue(env, "PATHEXT", platform) ?? ".EXE;.COM;.CMD;.BAT").split(";").filter((ext) => /^\.(exe|com)$/i.test(ext)) : [""];
  const roots = paths.isAbsolute(command) ? [""] : (environmentValue(env, "PATH", platform) ?? "").split(platform === "win32" ? ";" : ":").filter((path) => paths.isAbsolute(path));
  if (roots.length > 256) throw new Error("Executable PATH exceeds the directory budget");
  if (!paths.isAbsolute(command) && /[/\\]/.test(command)) return [];
  return roots.flatMap((root) => extensions.map((extension) => root ? paths.join(root, command + extension) : command + extension));
}

export async function findExecutable(command: string, env: NodeJS.ProcessEnv = process.env, signal?: AbortSignal) {
  for (const candidate of executableCandidates(command, env)) {
    signal?.throwIfAborted();
    try {
      const path = await realpath(candidate);
      if (!(await stat(path)).isFile()) continue;
      await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch { signal?.throwIfAborted(); }
  }
  return undefined;
}

export function platformPathEnvironment(source: NodeJS.ProcessEnv, platform = process.platform) {
  if (platform !== "win32") return {};
  const result: NodeJS.ProcessEnv = {};
  for (const key of ["SystemRoot", "WINDIR", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "PATHEXT"]) {
    const value = environmentValue(source, key, platform);
    if (value) result[key] = value;
  }
  return result;
}
