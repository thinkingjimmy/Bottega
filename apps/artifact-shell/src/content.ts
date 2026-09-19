/**
 * [INPUT]: Validated snapshot files, pure HTML/import-map parsing, offline resources and the shared viewer shell.
 * [OUTPUT]: A self-contained document with relative resources, module aliases and scopes resolved in memory.
 * [POS]: Trusted preparation boundary; artifact HTML is never placed in the hosting origin's DOM or cache.
 */
import { parse, parseFragment, serialize, defaultTreeAdapter as tree, type DefaultTreeAdapterTypes as Tree } from "parse5";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { artifactViewerShell } from "@ai-chat/cloud-protocol/artifacts/viewer-shell";
import { ArtifactResources, artifactResourcePath, type ArtifactResource } from "./resources";
import { artifactResourceRuntime } from "./runtime";
import { artifactModuleMap } from "./modules";
export type { ArtifactResource } from "./resources";
export function prepareContent(fence: ArtifactFence, files: ArtifactResource[], theme: "light" | "dark"): string {
  const entry = fence.kind === "static-site" ? fence.entry : files[0]!.path;
  const file = files.find(file => file.path === entry); if (!file) throw new Error("artifact-entry-missing");
  const base = artifactResourcePath(entry!);
  const doc = parse(artifactViewerShell({ html: new TextDecoder("utf-8", { fatal: true }).decode(file.bytes), title: fence.title,
    document: fence.kind === "static-site" || fence.kind === "html-document", theme }));
  let head: Tree.Element | undefined;
  const text = (element: Tree.Element) => element.childNodes.map(node => "value" in node ? node.value : "").join("");
  const replace = (element: Tree.Element, value: string) => { element.childNodes = []; tree.insertText(element, value); };
  const maps: string[] = [];
  const collectMaps = (node: Tree.Node) => {
    if ("tagName" in node && node.tagName === "script" && node.attrs.some(attr => attr.name === "type" && attr.value.toLowerCase() === "importmap")) {
      if (!node.attrs.some(attr => attr.name === "src")) maps.push(text(node));
      tree.detachNode(node); return;
    }
    // Template contents are inert and must not contribute document-wide import maps.
    if ("childNodes" in node) for (const child of [...node.childNodes]) collectMaps(child);
  };
  collectMaps(doc);
  const moduleMap = artifactModuleMap(maps, base), resources = new ArtifactResources(files, moduleMap);
  const walk = (node: Tree.Node) => {
    if ("tagName" in node) {
      if (node.tagName === "head") head = node;
      // A supplied base or refresh cannot change resource resolution or cause a network navigation.
      if (node.tagName === "base" || node.tagName === "meta" && node.attrs.some(attr => attr.name === "http-equiv" && attr.value.toLowerCase() === "refresh")) { tree.detachNode(node); return; }
      for (const attribute of node.attrs) {
        if (["src", "href", "poster", "data"].includes(attribute.name)) attribute.value = resources.url(attribute.value, base);
        if (attribute.name === "style") attribute.value = resources.css(attribute.value, base);
        if (attribute.name === "srcset" && !attribute.value.includes("data:")) attribute.value = attribute.value.split(",").map(item => item.trim().replace(/^\S+/, value => resources.url(value, base))).join(", ");
      }
      if (node.tagName === "style") replace(node, resources.css(text(node), base));
      const type = node.attrs.find(attr => attr.name === "type")?.value.toLowerCase();
      if (node.tagName === "script" && !node.attrs.some(attr => attr.name === "src") && (!type || ["module", "text/javascript", "application/javascript"].includes(type))) replace(node, resources.script(text(node), base));
    }
    if ("childNodes" in node) for (const child of [...node.childNodes]) walk(child);
    if ("content" in node) walk((node as Tree.Template).content);
  };
  walk(doc); if (!head) throw new Error("artifact-document-invalid");
  const entries = resources.entries();
  const prefix = parseFragment(`<script type="importmap">${JSON.stringify(resources.importMap(entries)).replace(/</g, "\\u003c")}</script><script>${artifactResourceRuntime(entries, base, moduleMap)}</script>`);
  const first = head.childNodes[0];
  for (const node of [...prefix.childNodes]) { tree.detachNode(node); if (first) tree.insertBefore(head, node, first); else tree.appendChild(head, node); }
  const html = serialize(doc);
  if (new TextEncoder().encode(html).length > 100_000_000) throw new Error("artifact-expanded-budget");
  return html;
}
