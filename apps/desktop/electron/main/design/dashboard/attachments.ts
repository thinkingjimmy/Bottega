/**
 * [INPUT]: Complete fixed Dashboard documents and blob metadata validated by the shared source reader.
 * [OUTPUT]: Bounded exact attachment names, MIME types, byte sizes and conservative reference state.
 * [POS]: Data-only Sources inventory; file bytes stay with the fixed source and existing journal.
 */
import { readDashboardSource } from "@ai-chat/cloud-protocol/artifacts/design/dashboard/model";
export function dashboardAttachments(files: readonly { path: string; data: Uint8Array }[], documentId: string) {
  const source = readDashboardSource(files, documentId), documents = JSON.stringify(source.documents);
  return [...source.blobs].sort(([a], [b]) => a.localeCompare(b)).map(([id, bytes]) => {
    const record = files.find(file => file.path === "_blobs/" + id + ".json"); if (!record) throw new Error("Attachment metadata is missing");
    const meta = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(record.data)) as { name: string; contentType: string };
    return { id, name: meta.name, contentType: meta.contentType, bytes: bytes.byteLength, used: documents.includes(id) };
  });
}
