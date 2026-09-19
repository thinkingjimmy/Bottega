/**
 * [INPUT]: Main-owned Chat Home, workspace/session roots, explicit references and guarded file readers.
 * [OUTPUT]: Immutable admitted snapshot bytes and relative, path-free card metadata.
 * [POS]: Artifact security admission before any renderer or synchronization publication.
 */
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { MAX_BLOB_BYTES } from "@ai-chat/cloud-protocol";
import { packArtifactArchive } from "@ai-chat/cloud-protocol/artifacts/archive";
import type { ArtifactFence, ArtifactKind, ArtifactReference } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { ARTIFACT_BUDGET } from "../../../shared/artifact-ipc";
import { collectArtifactResources, ignoredArtifactName, resourceReferences } from "./discovery/resources";
import { readArtifactSource } from "./storage/guarded-read";
export type ArtifactRoots = { workspace: string; artifacts: string; sessionId?: string; session?: string };
export type AdmittedArtifact = { fence: ArtifactFence; data: Uint8Array };
export const artifactHash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
export function artifactMime(path: string): string {
  return ({ ".html": "text/html", ".htm": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
    ".md": "text/markdown", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".pdf": "application/pdf", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".csv": "text/csv", ".woff": "font/woff", ".woff2": "font/woff2", ".ico": "image/x-icon" } as Record<string, string>)[extname(path).toLowerCase()] ?? "application/octet-stream";
}
const within = (root: string, path: string) => { const name = relative(root, path); return name === "" || (!isAbsolute(name) && name !== ".." && !name.startsWith(".." + sep)); };
function decode(data: Uint8Array) {
  try { const value = new TextDecoder("utf-8", { fatal: true }).decode(data); if (value.includes("\uFFFD")) throw new Error(); return value; }
  catch { throw new Error("not-utf8"); }
}
export async function admitArtifact(roots: ArtifactRoots, reference: ArtifactReference, id: string): Promise<AdmittedArtifact> {
  const target = resolve(roots.workspace, reference.path);
  const visualizationRoot = join(homedir(), ".codex", "visualizations");
  const sessionParts = relative(visualizationRoot, target).split(sep);
  const boundSessionRoot = roots.sessionId && sessionParts[3] === roots.sessionId && /^\d{4}$/.test(sessionParts[0] ?? "") &&
    sessionParts.slice(1, 3).every(value => /^\d{2}$/.test(value)) ? join(visualizationRoot, ...sessionParts.slice(0, 4)) : roots.session;
  const candidates = [["artifacts", roots.artifacts], ["workspace", roots.workspace], ["session", boundSessionRoot]] as const;
  const selected = candidates.find(([, root]) => root && within(root, target));
  if (!selected?.[1]) throw new Error("path-denied");
  const [location, root] = selected;
  const cleanRoot = await realpath(root);
  if (location === "session" && cleanRoot !== root) throw new Error("symlink");
  const name = relative(root, target);
  if (name.split(sep).some(ignoredArtifactName)) throw new Error("path-denied");
  const path = resolve(cleanRoot, name);
  const info = await lstat(path).catch(() => { throw new Error("path-denied"); });
  if (info.isSymbolicLink() || await realpath(path) !== path) throw new Error("symlink");
  if (info.isDirectory() && location !== "artifacts") throw new Error("path-denied");
  const entryPath = info.isDirectory() ? join(path, "index.html") : path;
  const ext = extname(entryPath).toLowerCase();
  let mime = artifactMime(entryPath), data = await readArtifactSource(entryPath, MAX_BLOB_BYTES);
  let kind: ArtifactKind = ({ ".html": "html-document", ".htm": "html-document", ".md": "markdown", ".svg": "svg", ".pdf": "pdf", ".xlsx": "xlsx", ".docx": "docx", ".pptx": "pptx", ".csv": "csv" } as Record<string, ArtifactKind>)[ext] ?? (mime.startsWith("image/") ? "image" : "file");
  let text: string | undefined, collection: ArtifactFence["collection"], entry: string | undefined, files: number | undefined;
  if (["html-document", "markdown", "svg", "csv"].includes(kind)) text = decode(data);
  if (kind === "pdf" && !Buffer.from(data.subarray(0, 5)).equals(Buffer.from("%PDF-"))) throw new Error("unsupported");
  if (["xlsx", "docx", "pptx"].includes(kind) && (data[0] !== 80 || data[1] !== 75)) throw new Error("unsupported");
  if (kind === "html-document") {
    kind = /<!doctype|<(?:html|head|body)\b/i.test(text!) ? "html-document" : "html-fragment";
    if (data.length > (kind === "html-fragment" ? ARTIFACT_BUDGET.fragment : ARTIFACT_BUDGET.document)) throw new Error("too-large");
    if (info.isDirectory() || (kind === "html-document" && resourceReferences(text!).length > 0)) {
      const directory = info.isDirectory() ? path : dirname(path);
      try {
        const resources = await collectArtifactResources(directory, entryPath, location === "artifacts");
        if (resources.length > 1 || info.isDirectory()) {
          data = packArtifactArchive(resources); kind = "static-site"; mime = "application/x-tar";
          entry = relative(directory, entryPath).split(sep).join("/"); files = resources.length;
          collection = location === "artifacts" ? "tree" : "dependencies";
        }
      } catch (error) {
        if (!(error instanceof Error) || !["too-large", "artifact-archive-budget", "artifact-archive-name"].includes(error.message)) throw error;
        collection = "entry-only";
      }
    }
  }
  const inferred = text?.match(/<(?:title|h1)\b[^>]*>([\s\S]*?)<\/(?:title|h1)>/i)?.[1]?.replace(/<[^>]*>/g, "").trim();
  const title = (reference.title ?? inferred ?? basename(entryPath, ext).replace(/[-_]/g, " ")).slice(0, 250) || "Artifact";
  return { data, fence: { v: 1, id, kind, title, ...(reference.mode ? { mode: reference.mode } : {}),
    identityKey: relative(cleanRoot, entryPath).split(sep).join("/"), location, sha256: artifactHash(data), bytes: data.length, mime,
    ...(entry ? { entry, files } : {}), ...(collection ? { collection } : {}), createdAt: Date.now() } };
}
