/**
 * [INPUT]: Depends on the sandbox foreignSensitive declaration, Node canonical filesystem paths and a main-owned environment snapshot.
 * [OUTPUT]: Provides the common plugin sensitive-path policy and canonical-path checks for main file and process proxies.
 * [POS]: D-9 authority shared with the package Seatbelt boundary; no plugin can exempt a Provider directory.
 */
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { foreignSensitive, type FenceScope } from "../../backends/sandbox/fences";
export type PluginPathScope = FenceScope;
export const pluginPathScope = (): PluginPathScope => ({ userHome: homedir(), env: { ...process.env } });
const within = (path: string, root: string) => { const rest = relative(root, path); return rest === "" || (!rest.startsWith(`..${sep}`) && rest !== ".." && !isAbsolute(rest)); };
export async function canonicalPluginPath(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\0")) throw new Error("Plugin file path must be absolute");
  let cursor = resolve(path);
  const suffix: string[] = [];
  while (true) {
    try { return resolve(await realpath(cursor), ...suffix); }
    catch (cause) {
      if (!["ENOENT", "ENOTDIR"].includes((cause as NodeJS.ErrnoException).code ?? "")) throw cause;
      const parent = dirname(cursor);
      if (parent === cursor) throw cause;
      suffix.unshift(cursor.slice(parent.length + (parent === sep ? 0 : 1))); cursor = parent;
    }
  }
}
export async function pluginSensitivePaths(scope: PluginPathScope = pluginPathScope()) {
  const sensitive = foreignSensitive(undefined, scope);
  const lexical = [...new Set([...sensitive.roots, ...sensitive.files].map(path => resolve(path)))];
  return [...new Set([...lexical, ...await Promise.all(lexical.map(canonicalPluginPath))])];
}
export async function assertPluginPath(path: string, scope: PluginPathScope = pluginPathScope()) {
  const canonical = await canonicalPluginPath(path);
  const roots = await pluginSensitivePaths(scope);
  if (roots.some(root => within(resolve(path), root) || within(canonical, root))) {
    throw Object.assign(new Error(`Plugin sensitive path denied: ${path}`), { code: "sensitive-path" });
  }
  return canonical;
}
