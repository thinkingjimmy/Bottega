/**
 * [INPUT]: Digest-verified captured modules, locked esbuild syntax lowering and actual import/require syntax.
 * [OUTPUT]: dcConnectedGraph selects only compatible captured versions sharing reachable code modules and their exact captured dependency graph.
 * [POS]: DC graph identity; broad source inventories cannot make unrelated React19 files part of a native component.
 */
import { posix } from "node:path";
import { parse } from "acorn";
import type { Loader } from "esbuild";
import type { DesignSystem, SystemComponent } from "@ai-chat/cloud-protocol/artifacts/design/system/model";
import { sourcePath } from "../../documents/model";
import { scriptReferences } from "../../documents/resources/script";
import type { capturedComponentInputs } from "./captured";
type Inputs = ReturnType<typeof capturedComponentInputs>;
export function dcSourceLoader(path: string): Loader {
  return ({ ".tsx": "tsx", ".ts": "ts", ".jsx": "jsx", ".js": "js", ".mjs": "js", ".cjs": "js", ".json": "json", ".css": "css" } as Record<string, Loader>)[posix.extname(path).toLowerCase()] ?? "dataurl";
}
export function dcRelativeModule(input: Inputs, importer: string, value: string) {
  if (/^(?:[a-z]+:|\/|\\)/i.test(value)) return undefined;
  const path = posix.normalize(posix.join(posix.dirname(importer), value));
  if (!sourcePath.safeParse(path).success) return undefined;
  return [path, ...[".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".json", ".css", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"].map(suffix => path + suffix)].find(path => input.sources.has(path));
}
function requireImports(code: string) {
  const result: string[] = [];
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.type === "CallExpression") {
      const callee = node.callee as { type?: string; name?: string }, args = node.arguments as { type?: string; value?: unknown }[];
      if (callee?.type === "Identifier" && callee.name === "require" && args[0]?.type === "Literal" && typeof args[0].value === "string") result.push(args[0].value);
    }
    for (const child of Object.values(node)) if (Array.isArray(child)) child.forEach(walk); else if (child && typeof child === "object") walk(child);
  };
  try { walk(parse(code, { ecmaVersion: "latest", sourceType: "module" })); } catch { /* The selected compiler reports syntax errors. */ }
  return result;
}
export async function dcConnectedGraph(system: DesignSystem, selected: SystemComponent, input: Inputs) {
  const { transform } = await import("esbuild"), dependencies = new Map<string, Set<string>>();
  for (const path of input.sources.keys()) {
    const edges = new Set<string>(); dependencies.set(path, edges);
    if (!/\.[cm]?[jt]sx?$/i.test(path)) continue;
    try {
      const result = await transform(input.load(path), { loader: dcSourceLoader(path), format: "esm", jsx: "transform", target: "es2022", logLevel: "silent" });
      for (const value of [...scriptReferences(result.code).map(reference => reference.url), ...requireImports(result.code)]) {
        if (!value.startsWith(".")) continue;
        const resolved = dcRelativeModule(input, path, value); if (resolved) edges.add(resolved);
      }
    } catch { /* Unrelated invalid code is not selected; selected syntax is checked by the compiler. */ }
  }
  const closure = (entry: string) => {
    const paths = new Set<string>();
    const visit = (path: string) => { if (paths.has(path)) return; paths.add(path); for (const child of dependencies.get(path) ?? []) visit(child); };
    visit(entry); return paths;
  };
  const facts = new Map(system.sources.files.map(source => [source.capturedPath, source]));
  const compatible = system.components.components.filter(component => input.sources.get(component.entry)?.digest === component.sourceDigest &&
    component.closure.every(path => { const source = facts.get(path); return source && input.sources.get(source.path)?.digest === source.digest; }));
  const closures = new Map(compatible.map(component => [component, closure(component.entry)]));
  const components = new Set([selected]), paths = new Set(closures.get(selected));
  for (let changed = true; changed;) {
    changed = false;
    for (const [component, next] of closures) if (!components.has(component) && [...next].some(path => /\.[cm]?[jt]sx?$/i.test(path) && paths.has(path))) {
      components.add(component); changed = true; for (const path of next) paths.add(path);
    }
  }
  return { components: [...components].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0), paths };
}
