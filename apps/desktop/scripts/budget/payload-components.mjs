/**
 * [INPUT]: Depends on Node fs/path and the package roles of runtime-dependencies.json
 * [OUTPUT]: Provides PAYLOAD_COMPONENTS, toolchainPackages (unpacked packages reached only from App-GUI-only roots), payloadComponents (a macOS app bundle's logical payload split into frameworks, bundled Node, app.asar, App GUI toolchain, other runtime modules and the rest, summing to unpackedPayloadBytes) and componentBudgetFailures (each component against its baseline plus the release headroom)
 * [POS]: The attribution half of the release size gate; verify-packaged-payload measures and asserts through it, release-budgets.json owns the numbers
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const PAYLOAD_COMPONENTS = Object.freeze(["frameworks", "bundled-node", "app-asar", "app-gui-toolchain", "runtime-modules", "other"]);

const isAppGuiOnly = (entry) => entry.roles.length === 1 && entry.roles[0] === "appGui";

/* A package the main process or an adapter can reach stays a runtime module even when the App GUI compiler also uses it:
   moving it out would break the runtime, so only what App-GUI-only roots reach and nothing else reaches is the toolchain. */
export function toolchainPackages(modules, manifestPackages) {
  const edges = (name) => {
    try {
      const pkg = JSON.parse(readFileSync(join(modules, name, "package.json"), "utf8"));
      return Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies });
    } catch { return []; }
  };
  const reach = (roots) => {
    const seen = new Set(), queue = [...roots];
    while (queue.length) {
      const name = queue.shift();
      if (seen.has(name) || !existsSync(join(modules, name))) continue;
      seen.add(name);
      queue.push(...edges(name));
    }
    return seen;
  };
  const roots = Object.entries(manifestPackages);
  const runtime = reach(roots.filter(([, entry]) => !isAppGuiOnly(entry)).map(([name]) => name));
  return new Set([...reach(roots.filter(([, entry]) => isAppGuiOnly(entry)).map(([name]) => name))].filter(name => !runtime.has(name)));
}

/* Same counting rule as unpackedPayloadBytes: regular files by size, links as zero and never followed, hard links not deduplicated. */
export function payloadComponents(appPath, manifestPackages) {
  const modules = join(appPath, "Contents", "Resources", "app.asar.unpacked", "node_modules");
  const toolchain = existsSync(modules) ? toolchainPackages(modules, manifestPackages) : new Set();
  const classify = (path) => {
    const [contents, area, item, nested, scope, name] = relative(appPath, path).split(sep);
    if (contents !== "Contents") return "other";
    if (area === "Frameworks") return "frameworks";
    if (area !== "Resources") return "other";
    if (item === "runtime") return "bundled-node";
    if (item === "app.asar") return "app-asar";
    if (item !== "app.asar.unpacked") return "other";
    if (nested !== "node_modules") return "runtime-modules";
    return toolchain.has(scope?.startsWith("@") ? `${scope}/${name}` : scope) ? "app-gui-toolchain" : "runtime-modules";
  };
  const totals = Object.fromEntries(PAYLOAD_COMPONENTS.map(component => [component, 0]));
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), stat = lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) totals[classify(path)] += stat.size;
    }
  };
  walk(appPath);
  return totals;
}

/** Every component of this platform needs a baseline once the table exists, so a new component cannot ship unmeasured. */
export function componentBudgetFailures(budgets, payloadKey, measured) {
  const table = budgets.components?.[payloadKey];
  if (!table || !measured) return { asserted: 0, over: [] };
  const headroom = budgets.components.headroom, over = [];
  for (const component of PAYLOAD_COMPONENTS) {
    const baseline = table[component];
    if (!Number.isSafeInteger(baseline)) { over.push(`${payloadKey} ${component}: no baseline`); continue; }
    const limit = Math.ceil(baseline * (1 + headroom));
    if (measured[component] > limit) over.push(`${payloadKey} ${component} ${measured[component]} > ${limit} (baseline ${baseline} + ${Math.round(headroom * 100)}%)`);
  }
  return { asserted: PAYLOAD_COMPONENTS.length, over };
}
