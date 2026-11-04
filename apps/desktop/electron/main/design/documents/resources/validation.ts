/**
 * [INPUT]: Complete fixed bytes, explicit native source dispatch, closed manifests/native comment data, current system source definitions and shared loaded-resource graph rules.
 * [OUTPUT]: Checks the same loaded dependency graph and render budgets used by preview preparation.
 * [POS]: Document validation; it cannot write registry, history, Chat or files.
 */
import { readDesignManifest } from "@ai-chat/cloud-protocol/artifacts/design/core/source";
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
    const indexPath = sources.has("dashboard.json") ? "dashboard.json" : sources.has("deck.json") ? "deck.json" : "canvas.json";
    const bytes = sources.get(indexPath)?.data;
    if (!bytes) { issue("canvas.json", "An explicit current document index is required"); return { manifest, issues }; }
    const current = readDesignManifest(readSet.files, readSet.path.split("/")[1]!);
    if (current.contentFormat || current.system) (await import("@ai-chat/cloud-protocol/artifacts/design/native/comments")).readNativeComments(readSet.files);
    const parsed = manifestSchema.safeParse(current);
    if (parsed.success) manifest = parsed.data;
    else for (const problem of parsed.error.issues) issue("canvas.json", `${problem.path.join(".")}: ${problem.message}`);
  } catch (cause) { issue("canvas.json", cause instanceof Error ? cause.message : "Manifest must be valid UTF-8 JSON"); }
  if (manifest && readSet.path !== `${manifest.format === "bottega-design-system" ? "design-systems" : "design"}/${manifest.documentId}`) issue("canvas.json", "documentId and format must match the directory");
  if (manifest?.contentFormat === "dashboard/v1") {
    try { await (await import("../../dashboard/resources")).dashboardResources(readSet.files, manifest.documentId); }
    catch (cause) { issue("dashboard.json", cause instanceof Error ? cause.message : "Invalid Dashboard resource closure"); }
    return { manifest, issues };
  }
  if (sources.has("db/data/users/local/runs.json")) issue("db/data/users/local/runs.json", "Page state requires the explicit Dashboard format");
  for (const board of manifest?.boards ?? []) {
    const file = sources.get(board.file);
    if (!file) { issue(board.file, "Board file is missing"); continue; }
    try { if (manifest?.contentFormat !== "slides/v4") assertHtmlDocument(file.data); }
    catch { issue(board.file, "Board must be a complete UTF-8 HTML document"); }
  }
  const inertSources = manifest && (manifest.system || manifest.systems?.length) ? (await import("../../systems/service")).inertSystemSources(readSet) : new Set<string>();
  for (const file of readSet.files) {
    if (inertSources.has(file.path)) continue;
    if (!/\.(?:html|css|[cm]?js|svg)$/i.test(file.path)) continue;
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(file.data); }
    catch { issue(file.path, "Text resource is not valid UTF-8"); continue; }
    for (const reference of await designResourceReferences(text, file.path)) {
      try {
        const target = manifest?.contentFormat ? (await import("../../native/resources")).nativeResourceTarget(file.path, reference.url, new Set(sources.keys())) : designResourceTarget(file.path, reference.url);
        if (target && inertSources.has(target)) { issue(file.path, "Captured source code is inert provenance; compile before rendering"); continue; }
        if (target && target !== "@runtime/support.js" && !sources.has(target)) throw new Error();
      } catch (cause) { issue(file.path, cause instanceof Error && cause.message === "Slides resources are relative to the deck root"
        ? cause.message + ": " + reference.url.slice(0, 200)
        : `${reference.kind === "navigation" ? "Navigation target" : "Resource"} is missing or outside the document: ${reference.url.slice(0, 200)}`); }
    }
  }
  if (manifest?.contentFormat === "slides/v4" && !issues.length) {
    try {
      for (const value of await (await import("../../native/slides-check")).checkNativeSlides(readSet.files)) issue(value.file, value.message);
      const deck = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(sources.get("deck.json")!.data)) as { faces?: Record<string, { src?: string; href?: string }> };
      for (const face of Object.values(deck.faces ?? {})) {
        if (!face.src || face.href) { issue("deck.json", "Capture the selected font CSS, bytes and license before saving this deck"); continue; }
        const target = (await import("../../native/resources")).nativeResourceTarget("deck.json", face.src, new Set(sources.keys()));
        if (!target || !sources.has(target)) issue("deck.json", "A captured native font resource is missing");
      }
    } catch (cause) { issue("deck.json", cause instanceof Error ? cause.message : "Native Slides compiler validation failed"); }
  }
  if (manifest?.format === "bottega-design-system") {
    for (const value of (await import("../../systems/validation")).validateDesignSystem(readSet)) issue(value.file, value.message);
  }
  if (manifest && !issues.length) {
    try { await (await import("./graph")).validateLoadedGraph(manifest, readSet); }
    catch (cause) { issue("canvas.json", cause instanceof Error ? cause.message : "Unsupported render dependency graph"); }
  }
  return { manifest, issues };
}

export async function requireValidDesignSet(readSet: DesignReadSet) {
  const result = await validateDesignSet(readSet);
  if (!result.manifest || result.issues.length) throw new DesignDocumentError("INVALID_DOCUMENT", "Document has structural or resource issues", result.issues);
  return result.manifest;
}
