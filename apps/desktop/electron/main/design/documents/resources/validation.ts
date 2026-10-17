/**
 * [INPUT]: Complete fixed bytes, closed manifests, canonical Canvas layers, raster decoder and local resource rules.
 * [OUTPUT]: Bounded format/structure/font/raster/closure issues and explicit untested behavior; no publication effects.
 * [POS]: Document validation; it cannot write registry, history, Chat or files.
 */
import { assertHtmlDocument } from "../../workspace/access";
import { DESIGN_LIMITS, DesignDocumentError, manifestSchema,
  type DesignIssue, type DesignManifest, type DesignReadSet } from "../model";
import { designResourceReferences, designResourceTarget } from "./references";

export const DESIGN_UNCHECKED = ["Visual quality", "JavaScript execution and interaction", "Dynamic resource references"] as const;
export async function validateDesignSet(readSet: DesignReadSet): Promise<{ manifest: DesignManifest | null; issues: DesignIssue[] }> {
  const issues: DesignIssue[] = [];
  const issue = (file: string, message: string) => { if (issues.length < DESIGN_LIMITS.issues) issues.push({ file, message: message.slice(0, 500) }); };
  const sources = new Map(readSet.files.map(file => [file.path, file]));
  let manifest: DesignManifest | null = null;
  try {
    const bytes = sources.get("canvas.json")?.data;
    if (!bytes) { issue("canvas.json", "Manifest is missing"); return { manifest, issues }; }
    const parsed = manifestSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (parsed.success) manifest = parsed.data;
    else for (const problem of parsed.error.issues) issue("canvas.json", `${problem.path.join(".")}: ${problem.message}`);
  } catch { issue("canvas.json", "Manifest must be valid UTF-8 JSON"); }
  if (manifest && readSet.path !== `${manifest.format === "bottega-design-system" ? "design-systems" : "design"}/${manifest.documentId}`) issue("canvas.json", "documentId and format must match the directory");
  for (const board of manifest?.boards ?? []) {
    const file = sources.get(board.file);
    if (!file) { issue(board.file, "Board file is missing"); continue; }
    try { assertHtmlDocument(file.data); }
    catch { issue(board.file, "Board must be a complete UTF-8 HTML document"); }
  }
  if (manifest?.objects?.length || manifest?.pages?.length) for (const value of await (await import("../../canvas/layers")).validateCanvasResources(manifest, readSet.files)) issue(value.file, value.message);
  const inertSources = manifest && (manifest.system || manifest.systems?.length) ? (await import("../../systems/service")).inertSystemSources(readSet) : new Set<string>();
  for (const file of readSet.files) {
    if (inertSources.has(file.path)) continue;
    if (!/\.(?:html|css|[cm]?js|svg)$/i.test(file.path)) continue;
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(file.data); }
    catch { issue(file.path, "Text resource is not valid UTF-8"); continue; }
    for (const reference of await designResourceReferences(text, file.path)) {
      try {
        const target = designResourceTarget(file.path, reference.url);
        if (target && inertSources.has(target)) { issue(file.path, "Captured source code is inert provenance; compile before rendering"); continue; }
        if (target && !sources.has(target)) throw new Error();
      } catch { issue(file.path, `${reference.kind === "navigation" ? "Navigation target" : "Resource"} is missing or outside the document: ${reference.url.slice(0, 200)}`); }
    }
  }
  if (manifest?.format === "bottega-design-system") {
    for (const value of (await import("../../systems/validation")).validateDesignSystem(readSet)) issue(value.file, value.message);
  }
  return { manifest, issues };
}

export async function requireValidDesignSet(readSet: DesignReadSet) {
  const result = await validateDesignSet(readSet);
  if (!result.manifest || result.issues.length) throw new DesignDocumentError("INVALID_DOCUMENT", "Document has structural or resource issues", result.issues);
  return result.manifest;
}
