/**
 * [INPUT]: Checked design-system data, exact captured sources and existing document bytes.
 * [OUTPUT]: Canonical JSON, derived CSS and an offline overview; unrelated user files remain untouched.
 * [POS]: System file projection for the single document commit/edit journal.
 */
import type { DesignSystem } from "@ai-chat/cloud-protocol/artifacts/design/system/model";
import { generatedSystemCss, cssTokenName, resolvedSystemValue } from "@ai-chat/cloud-protocol/artifacts/design/system/tokens";
import { designDigest, type DesignManifest } from "../documents/model";
import type { CapturedSources } from "./sources";
export const systemPaths = { tokens: "tokens.json", aliases: "aliases.json", sources: "sources.json", components: "components.json" } as const;
const encodedJson = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
export const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export function systemOverview(system: DesignSystem, title: string) {
  const html: string[] = ["<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">", `<title>${escapeHtml(title)}</title><link rel="stylesheet" href="tokens.css">`,
    "<style>body{font:15px system-ui,sans-serif;margin:24px;color:#202020;background:#fff}table{border-collapse:collapse;width:100%;margin-bottom:24px}th,td{text-align:left;padding:12px;border-bottom:1px solid #ddd;vertical-align:top}code{overflow-wrap:anywhere}caption{text-align:left;font-size:20px;font-weight:600;padding:12px 0}.swatch{display:inline-block;width:44px;height:32px;border:1px solid #777;vertical-align:middle;margin-right:8px}p{max-width:72ch}</style></head><body>",
    `<h1>${escapeHtml(title)}</h1><p>Values are copied from captured source files. Unsupported values remain visible as text. Components marked static have not been mounted.</p>`];
  for (const theme of system.tokens.themes) {
    html.push(`<section data-theme="${theme.id}"><table><caption>${escapeHtml(theme.name)}</caption><thead><tr><th>Token</th><th>Exact value</th><th>Usage</th></tr></thead><tbody>`);
    for (const token of system.tokens.tokens) {
      const value = token.values[theme.id] ?? token.values[system.tokens.themes[0]!.id] ?? "—";
      html.push(`<tr><td><code>${escapeHtml(token.name)}</code></td><td>${token.kind === "color" ? `<span class="swatch" style="background:var(--${cssTokenName(token.name)})"></span>` : ""}<code>${escapeHtml(value)}</code></td><td>${escapeHtml(token.usage)}</td></tr>`);
    }
    for (const alias of system.aliases.aliases.filter(value => value.theme === theme.id)) html.push(`<tr><td><code>${escapeHtml(alias.name)}</code></td><td><code>{${escapeHtml(alias.target)}} → ${escapeHtml(resolvedSystemValue(system, alias.name, theme.id) ?? "Unresolved")}</code></td><td>${escapeHtml(alias.usage)}</td></tr>`);
    html.push("</tbody></table></section>");
  }
  html.push("<h2>Components</h2><ul>");
  for (const component of system.components.components) html.push(`<li><strong>${escapeHtml(component.name)}</strong> · ${component.mode === "mounted" ? "Mounted in the controlled renderer" : "Static source inventory"} · ${escapeHtml(component.reason)}${component.preview ? ` · <a href="${component.preview}">Preview</a>` : ""}</li>`);
  html.push("</ul><h2>Not synced</h2><ul>");
  for (const value of system.sources.unsynced) html.push(`<li><code>${escapeHtml(value.path)}${value.name ? " · " + escapeHtml(value.name) : ""}</code>: ${escapeHtml(value.reason)}</li>`);
  return html.join("\n") + "</ul></body></html>\n";
}
export function initialSystemManifest(id: string): DesignManifest {
  return { schemaVersion: 1, format: "bottega-design-system", documentId: id, title: id,
    boards: [{ id: "overview", title: "Overview", file: "overview.html", mode: "responsive", viewport: { width: 1200, height: 900 } }],
    launchBoard: "overview", system: systemPaths };
}
export function projectSystemFiles(system: DesignSystem, manifest: DesignManifest, existing: readonly { path: string; data: Uint8Array }[] = [], capture?: CapturedSources) {
  const files = new Map<string, Buffer>(existing.map(file => [file.path, Buffer.from(file.data)]));
  const css = generatedSystemCss(system, manifest.title), currentStyles = designDigest(css);
  system.components.components = system.components.components.map(component => {
    if (component.mode !== "mounted" || component.evidence?.styleDigest === currentStyles) return component;
    const reason = "Static inventory: system values changed after the recorded mount. Mount this exact component again.";
    if (!system.sources.unsynced.some(item => item.kind === "component" && item.name === component.name && item.reason === reason)) system.sources.unsynced.push({ path: component.entry, kind: "component", name: component.name, reason });
    return { ...component, mode: "static", reason, preview: undefined, bundle: undefined, bundleDigest: undefined, evidence: undefined };
  });
  let previousPreviews: string[] = [];
  try { previousPreviews = (JSON.parse(files.get(manifest.system!.components)?.toString("utf8") ?? "{}").components ?? []).map((component: { preview?: string }) => component.preview).filter(Boolean); }
  catch { /* The caller's structural check reports invalid prior data. */ }
  const activePreviews = new Set(system.components.components.filter(component => component.mode === "mounted").map(component => component.preview));
  const stalePreviews = new Set(previousPreviews.filter(path => !activePreviews.has(path)));
  const projectedManifest = { ...manifest, boards: manifest.boards.filter(board => !board.id.startsWith("c_") || !stalePreviews.has(board.file)) };
  for (const source of capture?.files ?? []) files.set(source.record.capturedPath, source.data);
  const paths = manifest.system!;
  files.set(paths.tokens, encodedJson(system.tokens)); files.set(paths.aliases, encodedJson(system.aliases));
  files.set(paths.sources, encodedJson(system.sources)); files.set(paths.components, encodedJson(system.components));
  files.set("tokens.css", Buffer.from(css));
  files.set("overview.html", Buffer.from(systemOverview(system, manifest.title)));
  files.set("canvas.json", encodedJson(projectedManifest));
  if (!files.has("README.md")) files.set("README.md", Buffer.from([
    `Use the captured ${manifest.title} system at an explicit committed revision.`,
    "", "Load tokens.css once. Its values are generated from tokens.json and aliases.json. Preserve exact source values; unsupported colors require an explicit recommendation and user choice.",
    "", ...system.tokens.tokens.map(token => `- Use \`${token.name}\` as documented in its source usage field. ${token.kind}.`),
    "", "Read sources.json for precise file digests and Git versions. A workingTree source differs from the named commit; the captured file digest identifies the actual value.",
    "", "Read components.json before using a component. Static entries are inventories; only mounted entries have a controlled-renderer PNG and pinned compiler/runtime evidence.",
    "", "Bind the system with its document ID and exact revision. The consumer keeps its own immutable dependency closure. Updating this system does not change existing works.", "",
  ].join("\n")));
  return [...files].map(([path, data]) => ({ path, data }));
}
