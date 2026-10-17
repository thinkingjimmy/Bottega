/**
 * [INPUT]: Frozen CM operations, verified source/object values and the original Canvas/edit checkpoint input.
 * [OUTPUT]: Selection-scoped draft projection and closed text/style/link/list operation builders.
 * [POS]: Editor draft adapter; it defines no wire schema or save authority.
 */
import { canvasOperationSchema, type CanvasOperation, type CanvasTarget } from "@ai-chat/cloud-protocol/artifacts/design/canvas/commands";
import { canvasStyleSchema, type CanvasObject, type CanvasStyle } from "@ai-chat/cloud-protocol/artifacts/design/canvas/model";
import type { CanvasEdit, DesignEdit } from "../../../edits";
import type { DesignAnchor } from "@ai-chat/cloud-protocol/artifacts/design/review";
export type TextTarget = { kind: "object"; object: CanvasObject } | { kind: "source"; target: CanvasTarget };
export type TextExtras = { href?: string | null; list?: "none" | "ordered" | "unordered" };
export function draftOperation(checkpoint: CanvasEdit | undefined, target: TextTarget) {
  return checkpoint?.draft?.find(operation => target.kind === "object" ? operation.type === "object.update" && operation.objectId === target.object.id : operation.type === "source.update" && operation.anchor.boardId === target.target.anchor.boardId && operation.anchor.selector === target.target.anchor.selector);
}
export function draftStyle(operation: CanvasOperation | undefined): CanvasStyle {
  if (operation?.type === "object.update") return operation.changes.style ?? {};
  if (operation?.type === "source.update") return canvasStyleSchema.parse(Object.fromEntries(Object.entries(operation.changes ?? {}).filter(([key]) => key in canvasStyleSchema.shape)));
  return {};
}
export function targetText(target: TextTarget) {
  return target.kind === "source" ? target.target.values.text ?? target.target.anchor.currentText : "text" in target.object ? target.object.text : "";
}
export function shownText(target: TextTarget, operation: CanvasOperation | undefined, edit: DesignEdit, editing = false) {
  const value = operation?.type === "object.update" ? operation.changes.text : operation?.type === "source.update" ? operation.changes?.text : undefined;
  const same = target.kind === "source" ? edit.anchor?.selector === target.target.anchor.selector && edit.anchor?.boardId === target.target.anchor.boardId && edit.anchor?.boardDigest === target.target.anchor.boardDigest : operation?.type === "object.update" && operation.objectId === target.object.id && edit.anchor === null;
  if (target.kind === "source" && !operation && same && edit.value === edit.anchor?.currentText) return targetText(target);
  return editing && (same || target.kind === "object" && edit.anchor === null) && edit.property === "text" ? edit.value : value ?? targetText(target);
}
export function textOperation(target: TextTarget, previous: CanvasOperation | undefined, patch: { text?: string; style?: CanvasStyle; extras?: TextExtras }): CanvasOperation {
  if (target.kind === "object") {
    const changes = previous?.type === "object.update" ? previous.changes : {};
    return canvasOperationSchema.parse({ type: "object.update", objectId: target.object.id, changes: { ...changes,
      ...(patch.text !== undefined ? { text: patch.text } : {}), ...(patch.style ? { style: { ...changes.style, ...patch.style } } : {}), ...patch.extras } });
  }
  const operation = previous?.type === "source.update" ? previous : undefined;
  return canvasOperationSchema.parse({ type: "source.update", anchor: target.target.anchor, ...(operation ?? {}),
    ...((operation?.changes || patch.text !== undefined || patch.style && Object.keys(patch.style).length) ? { changes: { ...operation?.changes, ...patch.style, ...(patch.text !== undefined ? { text: patch.text } : {}) } } : {}), ...patch.extras });
}
export function sourceForObject(object: CanvasObject, anchor: DesignAnchor | null) {
  return anchor && anchor.boardId === object.boardId && anchor.selector === `#${object.id}` ? anchor : null;
}
