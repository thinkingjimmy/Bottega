/**
 * [INPUT]: One committed revision's complete immutable resource map and board identity.
 * [OUTPUT]: Offline frozen-board HTML with reachable-only resource copies, syntax-position resource rewrites, exact digests and manifest-owned board navigation.
 * [POS]: Snapshot renderer preparation; live workspace bytes never enter a committed render.
 */
import { artifactMime } from "../../artifacts/admission/files";
import { DESIGN_LIMITS, DesignDocumentError, designDigest } from "./model";
import { designResourceReferences, designResourceTarget } from "./resources/references";
import { rewriteReferences } from "./resources/types";
import type { DesignDocuments } from "./service";
import type { DesignRevision } from "./store";

export async function prepareDesignBoard(service: DesignDocuments, chatId: string, incarnationId: string,
  documentId: string, revision: number, boardId?: string) {
  const snapshot = await service.readRevision(chatId, incarnationId, documentId, revision);
  return prepareDesignSnapshot(snapshot, boardId);
}
export async function prepareDesignSnapshot(snapshot: { version: DesignRevision; files: { path: string; data: Uint8Array }[] }, boardId?: string) {
  const { documentId } = snapshot.version.manifest, { revision } = snapshot.version;
  const board = snapshot.version.manifest.boards.find(value => value.id === (boardId ?? snapshot.version.manifest.launchBoard));
  if (!board) throw new DesignDocumentError("INVALID_DOCUMENT", "Board ID is not in this revision");
  const files = new Map(snapshot.files.map(file => [file.path, file.data]));
  const cache = new Map<string, string>(), active = new Set<string>();
  let generatedBytes = 0;
  const prepare = async (path: string): Promise<string> => {
    const cached = cache.get(path); if (cached) return cached;
    const bytes = files.get(path);
    if (!bytes || active.has(path)) throw new DesignDocumentError("INVALID_DOCUMENT", `Missing or cyclic loaded render dependency: ${path}`);
    active.add(path);
    let content: Buffer = Buffer.from(bytes);
    if (/\.(?:html|css|[cm]?js|svg)$/i.test(path)) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), references = await designResourceReferences(text, path);
      const replacements = new Map<number, string>();
      for (const reference of references) {
        if (reference.kind === "navigation") continue;
        const target = designResourceTarget(path, reference.url); if (!target) continue;
        const hash = reference.url.indexOf("#"), fragment = hash < 0 ? "" : "#" + encodeURIComponent(reference.url.slice(hash + 1)).replaceAll("'", "%27");
        replacements.set(reference.start, await prepare(target) + fragment);
      }
      content = Buffer.from(rewriteReferences(text, references, reference => replacements.get(reference.start) ?? null));
    }
    active.delete(path);
    const uri = `data:${artifactMime(path)};base64,${content.toString("base64")}`;
    generatedBytes += Buffer.byteLength(uri);
    if (generatedBytes > DESIGN_LIMITS.archive) throw new DesignDocumentError("BUDGET_EXCEEDED", "Prepared render resources exceed the transfer budget");
    cache.set(path, uri); return uri;
  };
  const uri = await prepare(board.file);
  const navigation: Record<string, string> = {};
  for (const reference of await designResourceReferences(new TextDecoder().decode(files.get(board.file)!), board.file)) {
    if (reference.kind !== "navigation") continue;
    const target = designResourceTarget(board.file, reference.url), destination = snapshot.version.manifest.boards.find(value => value.file === target);
    if (destination) navigation[reference.url] = destination.id;
  }
  const html = Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");
  if (html.length > DESIGN_LIMITS.archive) throw new DesignDocumentError("BUDGET_EXCEEDED", "Prepared board exceeds the render budget");
  return { html, size: board.viewport, metadata: { documentId, revision, boardId: board.id,
    boardDigest: designDigest(files.get(board.file)!), readSetDigest: snapshot.version.readSetDigest,
    snapshotRef: snapshot.version.snapshotRef, navigation } };
}
