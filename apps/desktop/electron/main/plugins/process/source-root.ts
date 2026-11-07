/**
 * [INPUT]: The common plugin sensitive-path table, explicit main-owned profile scopes and canonical path resolution.
 * [OUTPUT]: assertPluginSourceRoot rejects recursive native-source intersections and returns the canonical safe root.
 * [POS]: Operation-loaded D9 root boundary for native source admission and Main source copy/inventory/freeze.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalPluginPath, pluginPathScope, pluginSensitivePaths, type PluginPathScope } from "./paths";
const contains = (root: string, path: string) => {
  const tail = relative(root, path);
  return tail === "" || tail !== ".." && !tail.startsWith(".." + sep) && !isAbsolute(tail);
};
export async function assertPluginSourceRoot(path: string, scope: PluginPathScope = pluginPathScope()): Promise<string> {
  const canonical = await canonicalPluginPath(path), lexical = resolve(path), sensitive = await pluginSensitivePaths(scope);
  if (sensitive.some(protectedPath => [lexical, canonical].some(root => contains(root, protectedPath) || contains(protectedPath, root))))
    throw Object.assign(new Error("Plugin source intersects a sensitive path: " + path), { code: "sensitive-path" });
  return canonical;
}
