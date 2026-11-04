/**
 * [INPUT]: Validated imported System bytes, a fresh manifest identity and original fixed DC preview props.
 * [OUTPUT]: Fresh actual isolated DC compile evidence under the new system namespace, preserving standalone source/resources.
 * [POS]: Import identity adaptation; old preview scripts are parsed as data and never executed in main.
 */
import { parse as htmlParse, type DefaultTreeAdapterMap } from "parse5";
import { parse as scriptParse } from "acorn";
import { canonicalJson } from "@bottega/contracts/core/canonical-json";
import { readCanonicalSystem } from "../systems/native/editor";
import { designDigest, type DesignManifest } from "../documents/model";
import { projectSystemFiles } from "../systems/files";
type Member = { path: string; data: Uint8Array };
function fixedProps(html: Uint8Array, expected: string): Record<string, unknown> {
  const document = htmlParse(new TextDecoder("utf-8", { fatal: true }).decode(html)), scripts: string[] = [];
  const visit = (node: DefaultTreeAdapterMap["node"]) => {
    if ("tagName" in node && node.tagName === "script" && node.attrs.some(value => value.name === "type" && value.value === "text/x-dc")) scripts.push(node.childNodes.filter(value => value.nodeName === "#text").map(value => "value" in value ? value.value : "").join(""));
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  }; visit(document);
  if (scripts.length !== 1) throw new Error("The fixed DC preview has no unique original props script");
  const found: unknown[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const value = node as Record<string, unknown>, key = value.key as { name?: string; value?: string } | undefined;
    if (value.type === "Property" && (key?.name ?? key?.value) === "componentProps") {
      const call = value.value as { type?: string; callee?: { type?: string; computed?: boolean; object?: { name?: string }; property?: { name?: string } }; arguments?: { type?: string; value?: unknown }[] };
      if (call.type !== "CallExpression" || call.callee?.type !== "MemberExpression" || call.callee.computed || call.callee.object?.name !== "JSON" || call.callee.property?.name !== "parse" || call.arguments?.length !== 1 || call.arguments[0]?.type !== "Literal" || typeof call.arguments[0].value !== "string") throw new Error("The DC preview props are not fixed JSON data");
      found.push(JSON.parse(call.arguments[0].value));
    }
    for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(walk); else if (child && typeof child === "object") walk(child);
  }; walk(scriptParse(scripts[0]!, { ecmaVersion: "latest" }));
  const props = found[0]; if (found.length !== 1 || !props || typeof props !== "object" || Array.isArray(props) || designDigest(canonicalJson(props)) !== expected) throw new Error("The original DC props digest does not match its fixed preview");
  return props as Record<string, unknown>;
}
export async function rehomeSystemComponents(files: readonly Member[], manifest: DesignManifest, signal: AbortSignal): Promise<readonly Member[]> {
  const system = readCanonicalSystem(manifest, files), candidates = system.components.components.filter(component => component.dc?.status === "ready" && component.dc.systemId !== manifest.documentId);
  if (!candidates.length) return files;
  const sources = new Map(files.map(file => [file.path, file.data])), replacement = new Map<string, string>();
  for (const component of candidates) {
    signal.throwIfAborted(); const dc = component.dc!; if (dc.status !== "ready") throw new Error("A fixed DC import changed status");
    const preview = sources.get(dc.preview); if (!preview || designDigest(preview) !== dc.previewDigest) throw new Error("A fixed DC preview is missing or corrupt");
    const compiled = await (await import("../systems/compile")).compileSystemComponent(system, component, [...sources].map(([path, data]) => ({ path, data })), fixedProps(preview, dc.propsDigest), "dc", manifest.documentId);
    signal.throwIfAborted(); system.components.components[system.components.components.indexOf(component)] = compiled.component;
    for (const file of compiled.files) sources.set(file.path, file.data); replacement.set(dc.preview, compiled.preview);
  }
  const next = { ...manifest, boards: manifest.boards.map(board => ({ ...board, file: replacement.get(board.file) ?? board.file })) };
  return projectSystemFiles(system, next, [...sources].map(([path, data]) => ({ path, data })));
}
