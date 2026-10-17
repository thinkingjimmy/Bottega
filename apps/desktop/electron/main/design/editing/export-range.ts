/**
 * [INPUT]: Closed export request and the exact immutable revision manifest.
 * [OUTPUT]: Validated normalized board/page/document range shared by rendering, cache and flight identity.
 * [POS]: Export range truth; no cache hit may bypass fixed-version target or format validation.
 */
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { canvasPages } from "@ai-chat/cloud-protocol/artifacts/design/canvas/view";
import type { DesignRevision } from "../documents/store";
import { DesignDocumentError } from "../documents/model";
type Options = { format: NonNullable<WorkspaceCommand["format"]>; paper: "a4" | "letter" };
export type DesignExportRange = Options & ({ scope: "document" } | { scope: "page"; pageId: string } | { scope: "board"; boardId: string });
export function normalizeDesignExportRange(input: WorkspaceCommand, version: Pick<DesignRevision, "manifest">): DesignExportRange {
  const invalid = (message: string): never => { throw new DesignDocumentError("INVALID_DOCUMENT", message); };
  const format = input.format ?? invalid("Select an export format");
  if (!["html", "png", "pdf-fixed", "pdf-flow"].includes(format)) invalid("This export format is unavailable");
  const scope = input.scope ?? (format === "png" ? "board" : "document"), paper = input.paper ?? "a4";
  if (!["board", "page", "document"].includes(scope)) invalid("Choose a board, page or document export range");
  if (!["a4", "letter"].includes(paper)) invalid("Choose A4 or Letter paper");
  const { manifest } = version;
  if (input.boardId !== undefined && !manifest.boards.some(board => board.id === input.boardId)) invalid("Choose a board in this fixed revision");
  if (input.pageId !== undefined && !canvasPages(manifest).some(page => page.id === input.pageId)) invalid("Choose a page in this fixed revision");
  if (scope === "page") return { format, paper, scope, pageId: input.pageId ?? invalid("Choose a page before exporting") };
  if (scope === "board") {
    const boardId = input.boardId ?? manifest.launchBoard;
    if (!manifest.boards.some(board => board.id === boardId)) invalid("Choose a board in this fixed revision");
    return { format, paper, scope, boardId };
  }
  if (format === "png") invalid("PNG exports one selected page or board. Select that range before exporting.");
  return { format, paper, scope: "document" };
}
