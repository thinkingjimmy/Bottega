/**
 * [INPUT]: Existing durable document journal, immutable validated archives and exact trusted workspace commands.
 * [OUTPUT]: Bounded on-demand History lists/details/differences and CAS restoration as a new original journal operation.
 * [POS]: Native History authority; no independent ledger, model invocation or source path supplied by the renderer.
 */
import { nativeHistoryResultSchema, type HistoryVersion, type NativeHistoryResult } from "@ai-chat/cloud-protocol/artifacts/design/history/model";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { readDesignManifest } from "@ai-chat/cloud-protocol/artifacts/design/core/source";
import { DesignDocumentError, requestKey } from "../documents/model";
import type { DesignDocuments } from "../documents/service";
import type { DesignRevision } from "../documents/store";
import { historyChanges, historyUnitText, restoreHistorySelection } from "./semantic";
import { completeHistoryRestore } from "./formats";
export function historyVersion(documents: DesignDocuments, version: DesignRevision): HistoryVersion {
  const operation = documents.store.operation(requestKey(version.authority, version.requestId)), action = operation?.sourceEdit?.input.action;
  const kind: HistoryVersion["author"]["kind"] = action === "native-history-restore" ? "restore" :
    action === "native-candidate-accept" || action === "native-chat-apply" || !action ? "agent" : "user";
  return { revision: version.revision, parentRevision: version.revision - 1, artifactId: version.artifactId, snapshotRef: version.snapshotRef,
    readSetDigest: version.readSetDigest, createdAt: operation?.imported?.at ?? version.createdAt, documentId: version.manifest.documentId, title: version.manifest.title.slice(0, 80),
    author: operation?.imported?.author ?? { kind, name: kind === "agent" ? version.backend.slice(0, 80) : "Local editor" }, operation: operation?.imported ? "project-import" : action ?? "source-commit" };
}
export async function nativeHistoryAction(documents: DesignDocuments, input: WorkspaceCommand, version: DesignRevision, assertExecution: () => void) {
  if (input.documentId !== version.manifest.documentId || !input.history) throw new DesignDocumentError("PATH_DENIED", "History belongs to another document");
  const authority = documents.authority(input.chatId, input.incarnationId), documentId = version.manifest.documentId;
  const fixed = documents.store.revision(authority, documentId, version.revision);
  if (fixed?.artifactId !== version.artifactId || fixed.snapshotRef !== version.snapshotRef) throw new DesignDocumentError("PATH_DENIED", "History is unavailable to this retained reference");
  const selection = input.history;
  const read = (revision: number) => documents.readRevision(input.chatId, input.incarnationId, documentId, revision);
  const result = (value: NativeHistoryResult) => nativeHistoryResultSchema.parse(value);
  if (input.action === "native-history-list") {
    const entries = documents.store.versions(authority, documentId).filter(value => !selection.cursor || value.revision < selection.cursor).sort((a, b) => b.revision - a.revision);
    return result({ kind: "list", entries: entries.slice(0, 8).map(value => historyVersion(documents, value)), nextCursor: entries.length > 8 ? entries[7]!.revision : null });
  }
  const target = await read(selection.revision!);
  if (target.version.manifest.format !== version.manifest.format || target.version.manifest.contentFormat !== version.manifest.contentFormat) throw new DesignDocumentError("INVALID_DOCUMENT", "History format is not supported by this editor");
  if (input.action === "native-history-detail") return result({ kind: "detail", version: historyVersion(documents, target.version) });
  const compareRevision = selection.compareRevision ?? version.revision, compared = await read(compareRevision);
  if (input.action === "native-history-diff") {
    if (selection.selection) {
      const left = historyUnitText(target.files, selection.selection), right = historyUnitText(compared.files, selection.selection), offset = selection.offset ?? 0;
      const length = Math.max(left?.length ?? 0, right?.length ?? 0);
      if (offset > length) throw new DesignDocumentError("INVALID_DOCUMENT", "History text cursor is outside the fixed source");
      return result({ kind: "content", ...selection.selection, before: left === null ? null : left.slice(offset, offset + 512), after: right === null ? null : right.slice(offset, offset + 512), offset,
        nextOffset: offset + 512 < length ? offset + 512 : null });
    }
    const changes = historyChanges(target.files, compared.files), cursor = selection.cursor ?? 0;
    if (cursor > changes.length) throw new DesignDocumentError("INVALID_DOCUMENT", "History cursor is outside the fixed difference");
    return result({ kind: "difference", revision: target.version.revision, compareRevision, changes: changes.slice(cursor, cursor + 8), total: changes.length,
      nextCursor: cursor + 8 < changes.length ? cursor + 8 : null });
  }
  if (input.action !== "native-history-restore") throw new DesignDocumentError("INVALID_DOCUMENT", "Unsupported History action");
  return documents.edit(input, version, async live => {
    if (!selection.items && compareRevision !== input.expectedRevision) throw new DesignDocumentError("REVISION_CONFLICT", "Review the current version before restoring a complete version");
    let files;
    try { files = selection.items ? await completeHistoryRestore({ format: version.manifest.system ? "design-system/v1" : version.manifest.contentFormat!, manifest: version.manifest, target: target.files, current: live.files, restored: restoreHistorySelection(target.files, compared.files, live.files, selection.items), selections: selection.items }) : target.files; }
    catch (cause) { throw new DesignDocumentError("REVISION_CONFLICT", cause instanceof Error ? cause.message : "History selection conflict"); }
    const manifest = readDesignManifest(files, documentId);
    if (manifest.documentId !== documentId || manifest.format !== version.manifest.format || manifest.contentFormat !== version.manifest.contentFormat) throw new DesignDocumentError("INVALID_DOCUMENT", "Restore cannot replace document identity or format");
    return files;
  }, assertExecution);
}
