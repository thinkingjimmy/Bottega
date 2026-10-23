/**
 * [INPUT]: Verified saved model geometry, the selected world box and trusted screen drag/resize output.
 * [OUTPUT]: One closed transform batch with group-relative position scaling and retained source axes.
 * [POS]: UI geometry adapter; only main capabilities allow a source transform.
 */
import { canvasOperationSchema, type CanvasOperation, type CanvasTarget } from "@ai-chat/cloud-protocol/artifacts/design/canvas/commands";
import type { CanvasObject } from "@ai-chat/cloud-protocol/artifacts/design/canvas/model";
import type { CanvasRead } from "@ai-chat/cloud-protocol/artifacts/design/canvas/view";
import type { CanvasBox } from "../../motion/camera";
import type { FrameHints } from "../../../../preview";
export function transformOperations({ objects, boards, allBoards, world, screen, next, zoom, source, hints }: { objects: CanvasObject[]; boards: CanvasRead["boards"]; allBoards: CanvasRead["boards"]; world: CanvasBox; screen: CanvasBox; next: CanvasBox; zoom: number; source?: CanvasTarget; hints: FrameHints }): CanvasOperation[] {
  const dx = (next.x - screen.x) / zoom, dy = (next.y - screen.y) / zoom, sx = next.width / screen.width, sy = next.height / screen.height;
  if (objects.length) return objects.map(object => {
    const parent = object.boardId && allBoards.find(board => board.id === object.boardId), px = parent ? parent.position.x : 0, py = parent ? parent.position.y : 0;
    return canvasOperationSchema.parse({ type: "object.update", objectId: object.id, changes: { bounds: { x: Math.round(world.x + dx + (object.bounds.x + px - world.x) * sx - px), y: Math.round(world.y + dy + (object.bounds.y + py - world.y) * sy - py), width: Math.max(1, Math.round(object.bounds.width * sx)), height: Math.max(1, Math.round(object.bounds.height * sy)) } } });
  });
  if (boards.length) return boards.map(board => canvasOperationSchema.parse({ type: "board.update", boardId: board.id, position: { x: Math.round(world.x + dx + (board.position.x - world.x) * sx), y: Math.round(world.y + dy + (board.position.y - world.y) * sy) }, viewport: { width: Math.max(40, Math.round(board.viewport.width * sx)), height: Math.max(40, Math.round(board.viewport.height * sy)) } }));
  if (!source?.geometry) return [];
  const changes: Record<string, string> = {};
  if (dx) changes.left = `${parseFloat(source.values.left ?? "0px") + dx}px`;
  if (dy) changes.top = `${parseFloat(source.values.top ?? "0px") + dy}px`;
  if (Math.abs(next.width - screen.width) > .5) changes.width = `${Math.max(1, parseFloat(hints.width ?? source.values.width ?? "0px") + (next.width - screen.width) / zoom)}px`;
  if (Math.abs(next.height - screen.height) > .5) changes.height = `${Math.max(1, parseFloat(hints.height ?? source.values.height ?? "0px") + (next.height - screen.height) / zoom)}px`;
  return Object.keys(changes).length ? [canvasOperationSchema.parse({ type: "source.update", anchor: source.anchor, changes })] : [];
}
