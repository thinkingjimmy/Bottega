/**
 * [INPUT]: Canonical JSON, fixed system source facts, selected component closures and immutable archive members.
 * [OUTPUT]: capturedComponentInputs verifies source bytes and token CSS; capturedComponentProps preserves canonical props as data.
 * [POS]: Shared source boundary for standalone and native DC component targets.
 */
import postcss from "postcss";
import { canonicalJson } from "@bottega/contracts/core/canonical-json";
import valueParser from "postcss-value-parser";
import type { DesignSystem, SystemComponent } from "@ai-chat/cloud-protocol/artifacts/design/system/model";
import { resolvedSystemToken, validTokenValue } from "@ai-chat/cloud-protocol/artifacts/design/system/tokens";
import { designDigest, DesignDocumentError } from "../../documents/model";
import { cssDeclarationTheme } from "../extract";
export function capturedComponentInputs(system: DesignSystem, components: readonly SystemComponent[], archive: readonly { path: string; data: Uint8Array }[]) {
  const closure = new Set(components.flatMap(component => component.closure));
  const records = system.sources.files.filter(source => closure.has(source.capturedPath));
  const sources = new Map(records.map(source => [source.path, source]));
  if (sources.size !== records.length) throw new DesignDocumentError("INVALID_DOCUMENT", "Component closure contains conflicting versions of the same source path");
  if (components.some(component => sources.get(component.entry)?.digest !== component.sourceDigest))
    throw new DesignDocumentError("INVALID_DOCUMENT", "Component entry does not match its selected captured source");
  const files = new Map(archive.map(file => [file.path, Buffer.from(file.data)]));
  if (components.some(component => !sources.has(component.entry)) || [...closure].some(path => !files.has(path)))
    throw new DesignDocumentError("INVALID_DOCUMENT", "Component captured closure is incomplete");
  const factNames = new Set([...system.tokens.tokens.map(value => value.name), ...system.aliases.aliases.map(value => value.name)]);
  const load = (path: string) => {
    const source = sources.get(path), bytes = source && files.get(source.capturedPath);
    if (!source || !bytes || designDigest(bytes) !== source.digest) throw new DesignDocumentError("INVALID_DOCUMENT", "Captured component source digest changed");
    if (!/\.css$/i.test(path)) return bytes;
    const ast = postcss.parse(bytes.toString("utf8"), { from: path });
    ast.walkDecls(declaration => {
      const name = declaration.prop.replace(/^--/, "").replaceAll("\\.", ".").replaceAll("/", "-");
      if (declaration.prop.startsWith("--") && factNames.has(name) && cssDeclarationTheme(declaration)) declaration.remove();
    });
    ast.walkDecls(declaration => { valueParser(declaration.value).walk(node => {
      if (node.type !== "function" || node.value !== "var") return;
      const first = node.nodes[0]; if (first?.type !== "word" || !first.value.startsWith("--")) return;
      const name = first.value.slice(2).replaceAll("\\.", "."); if (!factNames.has(name)) return;
      for (const theme of system.tokens.themes) {
        const target = resolvedSystemToken(system, name, theme.id);
        if (target && !validTokenValue(target.token.kind, target.value)) throw new DesignDocumentError("INVALID_DOCUMENT", "Cannot preserve exact " + name + " (" + theme.id + ") in generated component CSS");
      }
    }); });
    return Buffer.from(ast.toString());
  };
  return { sources, files, load };
}

export function capturedComponentProps(props: Record<string, unknown>) {
  const json = canonicalJson(props);
  return { json, digest: designDigest(json), literal: "JSON.parse(" + JSON.stringify(json).replaceAll("<", "\\u003c") + ")" };
}
