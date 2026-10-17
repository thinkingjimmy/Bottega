/**
 * [INPUT]: A complete immutable document read set and shared design-system structural rules.
 * [OUTPUT]: Bounded pure system issues, exact source/evidence hashes and generated-CSS consistency.
 * [POS]: Extension of the existing document checker; no registry or second commit owner.
 */
import { designDigest, manifestSchema, type DesignIssue, type DesignReadSet } from "../documents/model";
import { systemSourcesSchema } from "@ai-chat/cloud-protocol/artifacts/design/system/model";
import { inspectDesignSystem } from "@ai-chat/cloud-protocol/artifacts/design/system/validation";
import { generatedSystemCss } from "@ai-chat/cloud-protocol/artifacts/design/system/tokens";
import type { DesignManifest } from "../documents/model";
export function readDesignSystem(files: readonly { path: string; data: Uint8Array }[], manifest: DesignManifest) {
  if (manifest.format !== "bottega-design-system" || !manifest.system) throw new Error("This document is not a design system");
  const raw = Object.fromEntries(Object.entries(manifest.system).map(([name, path]) => {
    const file = files.find(file => file.path === path);
    if (!file || file.data.length > 1024 * 1024) throw new Error(`Missing or oversized system file: ${path}`);
    return [name, JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.data))];
  }));
  return inspectDesignSystem(raw, new Set(files.map(file => file.path)));
}
export function validateDesignSystem(readSet: DesignReadSet): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const issue = (file: string, message: string) => { if (issues.length < 32) issues.push({ file, message: message.slice(0, 500) }); };
  try {
    const manifestFile = readSet.files.find(file => file.path === "canvas.json");
    if (!manifestFile) return issues;
    const parsed = manifestSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestFile.data)));
    if (!parsed.success || parsed.data.format !== "bottega-design-system") return issues;
    const manifest = parsed.data, result = readDesignSystem(readSet.files, manifest);
    for (const value of result.issues) issue(value.file, value.message);
    if (!result.system) return issues;
    for (const source of result.system.sources.files) {
      const file = readSet.files.find(file => file.path === source.capturedPath);
      if (file && (file.data.length !== source.bytes || designDigest(file.data) !== source.digest)) issue("sources.json", `Captured source digest does not match ${source.path}`);
      if (source.version.kind === "digest" && source.version.digest !== source.digest) issue("sources.json", `Source version does not match captured bytes: ${source.path}`);
    }
    for (const component of result.system.components.components) {
      const source = result.system.sources.files.find(source => source.id === component.sourceId);
      if (source && source.digest !== component.sourceDigest) issue("components.json", `Component source digest does not match ${component.name}`);
      const closure = component.closure.map(path => [path, readSet.files.find(file => file.path === path)?.digest]);
      if (designDigest(JSON.stringify(closure)) !== component.closureDigest) issue("components.json", `Component dependency digest does not match ${component.name}`);
      const bundle = readSet.files.find(file => file.path === component.bundle), evidence = readSet.files.find(file => file.path === component.evidence?.file);
      if (bundle && designDigest(bundle.data) !== component.bundleDigest) issue("components.json", `Bundle digest does not match ${component.name}`);
      if (evidence && designDigest(evidence.data) !== component.evidence?.digest) issue("components.json", `Mount evidence digest does not match ${component.name}`);
      const styles = readSet.files.find(file => file.path === "tokens.css");
      if (component.mode === "mounted" && styles && designDigest(styles.data) !== component.evidence?.styleDigest) issue("components.json", `Mount evidence has stale system values: ${component.name}`);
    }
    const css = readSet.files.find(file => file.path === "tokens.css");
    if (!css || new TextDecoder("utf-8", { fatal: true }).decode(css.data) !== generatedSystemCss(result.system, manifest.title)) issue("tokens.css", "Generated CSS is missing or stale. Generate it from the current tokens and aliases; do not edit a second copy of token values.");
  } catch (error) { issue("canvas.json", error instanceof Error ? error.message : "System data must be valid bounded UTF-8 JSON"); }
  return issues;
}
export function inertSystemSources(readSet: DesignReadSet): Set<string> {
  const result = new Set<string>(), files = new Map(readSet.files.map(file => [file.path, file]));
  const inertCode = /\.(?:css|[cm]?js|jsx|tsx?)$/i;
  try {
    const manifest = manifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files.get("canvas.json")!.data)));
    const addSources = (bytes: Uint8Array, prefix: string, allowed?: ReadonlySet<string>) => {
      if (bytes.length > 1024 * 1024) return;
      const parsed = systemSourcesSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      if (!parsed.success) return;
      for (const source of parsed.data.files) {
        const path = prefix + source.capturedPath, file = files.get(path);
        if (inertCode.test(path) && file && (!allowed || allowed.has(path)) && designDigest(file.data) === source.digest) result.add(path);
      }
    };
    if (manifest.system && !validateDesignSystem(readSet).length) addSources(files.get(manifest.system.sources)!.data, "");
    for (const binding of manifest.systems ?? []) {
      const prefix = `systems/${binding.documentId}/`, allowed = new Set(binding.files);
      for (const path of binding.files) if (path.startsWith(prefix) && /\.json$/i.test(path)) {
        const file = files.get(path); if (file) { try { addSources(file.data, prefix, allowed); } catch { /* Raw source JSON remains inert data, never a metadata declaration. */ } }
      }
    }
  } catch { /* Invalid metadata cannot exempt any ordinary runtime resource. */ }
  return result;
}
