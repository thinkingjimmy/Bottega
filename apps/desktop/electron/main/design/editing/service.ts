/**
 * [INPUT]: Current main authority, immutable board bytes and shared Canvas source/object transforms.
 * [OUTPUT]: Finite property edits through the guarded Canvas adapter and existing recoverable document journal.
 * [POS]: Workspace property adapter; historical or dirty source is never silently overwritten.
 */
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { DesignRevision } from "../documents/store";
import { editCanvasRevision } from "../canvas/service";
export function editDesignRevision(input: WorkspaceCommand, snapshot: { version: DesignRevision; editable: boolean; files: { path: string; data: Uint8Array }[] }) {
  return editCanvasRevision(input, snapshot);
}
