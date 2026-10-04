/**
 * [INPUT]: Turn start time, artifact roots and main-only ACP tool location metadata.
 * [OUTPUT]: Bounded new/changed deliverables, Codex declarations and Claude publication URLs.
 * [POS]: Artifact discovery for script-produced files that do not emit file-change events.
 */
import { lstat, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { isClaudeArtifactUrl } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { ArtifactRoots } from "../admission";
import { ignoredArtifactName } from "./resources";
export type ArtifactToolMetadata = { locations?: string[]; title?: string };
export function artifactDeclaration(command: string) {
  if (!/(?:^|[\s/])mark_artifact_operation_started\.mjs\b/.test(command)) return null;
  const kind = command.match(/--operation-kind(?:=|\s+)["']?(create|edit)\b/)?.[1];
  const format = command.match(/--output-format(?:=|\s+)["']?([a-z0-9]+)/)?.[1];
  const count = Number(command.match(/--expected-output-count(?:=|\s+)["']?(\d+)/)?.[1]);
  return kind && format && count >= 1 && count <= 100 ? { format, count } : null;
}
export function claudeArtifactUrls(text: string) {
  return [...new Set((text.match(/https:\/\/(?:preview\.)?claude\.ai\/code\/artifact\/[A-Za-z0-9-]+/g) ?? []).filter(isClaudeArtifactUrl))];
}
export class ArtifactFileDiscovery {
  private readonly started = Date.now();
  private readonly observed = new Map<string, string>();
  private readonly declarations = new Set<string>();
  constructor(private readonly roots: ArtifactRoots) {}
  declare(command: string) { const value = artifactDeclaration(command); if (value) this.declarations.add(value.format); }
  private eligible(path: string) {
    const ext = extname(path).slice(1).toLowerCase();
    return ["pdf", "docx", "pptx", "xlsx"].includes(ext) || this.declarations.has(ext) ||
      (ext === "csv" && path.startsWith(this.roots.artifacts + "/"));
  }
  private admit(candidates: Set<string>, locations: readonly string[]) {
    for (const path of locations.slice(0, 200)) { const absolute = resolve(this.roots.workspace, path); if (this.eligible(absolute)) candidates.add(absolute); }
  }
  private async changes(candidates: Iterable<string>) {
    const result: string[] = [];
    for (const path of candidates) {
      const stat = await lstat(path).catch(() => null);
      if (!stat?.isFile() || stat.isSymbolicLink() || stat.mtimeMs < this.started) continue;
      const stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      if (this.observed.get(path) === stamp) continue;
      this.observed.set(path, stamp); result.push(path);
      if (result.length >= 8) break;
    }
    return result;
  }
  /** File-change items already name what they wrote; walking a repository again only repeats that evidence. */
  async locate(locations: readonly string[] = []) { const candidates = new Set<string>(); this.admit(candidates, locations); return this.changes(candidates); }
  async scan(locations: readonly string[] = []) {
    const candidates = new Set<string>(); let visited = 0;
    const roots = [...new Set([this.roots.artifacts, this.roots.workspace, this.roots.session].filter((value): value is string => Boolean(value)))];
    const nested = new Set(roots);
    const walk = async (root: string, depth: number) => {
      for (const item of await readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (++visited > 5000) return;
        if (ignoredArtifactName(item.name) || item.isSymbolicLink()) continue;
        const path = join(root, item.name);
        // A nested root (artifacts under the workspace) is walked once, from its own root.
        if (item.isDirectory() && depth < 3 && !nested.has(path)) await walk(path, depth + 1);
        else if (item.isFile() && this.eligible(path)) candidates.add(path);
      }
    };
    for (const root of roots) await walk(root, 0);
    this.admit(candidates, locations);
    return this.changes(candidates);
  }
}
