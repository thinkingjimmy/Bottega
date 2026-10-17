/**
 * [INPUT]: Fixed Canvas object/board and snapshot identity, scoped draft and the original edit controller; catalog-owned labels use the shared formatCopy formatter.
 * [OUTPUT]: Snapshot-bound raw fields, merged geometry/name drafts and cancellation from saved model values.
 * [POS]: Model inspector; stale local values cannot cross Save/Undo/target changes or replay canceled geometry.
 */
import { useEffect, useState } from "react";
import type { CanvasObject } from "@ai-chat/cloud-protocol/artifacts/design/canvas/model";
import { canvasOperationSchema, canvasOperationsSchema, type CanvasOperation } from "@ai-chat/cloud-protocol/artifacts/design/canvas/commands";
import type { CanvasRead } from "@ai-chat/cloud-protocol/artifacts/design/canvas/view";
import type { DesignEditController } from "../../../edits";
import { useArtifactHost } from "../../../../../context";
import { canvasCopy } from "../../copy";
import { Button } from "@ai-chat/ui/components/ui/button";
import { formatCopy } from "@ai-chat/ui/lib/workbench-copy/format";
type Fields = { x: string; y: string; width: string; height: string; title: string };
export function CanvasObjectProperties({ object, board, artifactId, controls, onUncheckpointed }: { object?: CanvasObject; board?: CanvasRead["boards"][number]; artifactId: string; controls: DesignEditController; onUncheckpointed?(value: boolean): void }) {
  const copy = canvasCopy(useArtifactHost()!.locale), checkpoint = controls.canvasDraft;
  const matches = (operation: CanvasOperation) => object ? operation.type === "object.update" && operation.objectId === object.id : operation.type === "board.update" && operation.boardId === board?.id;
  const operation = checkpoint?.draft?.find(matches), savedBox = object?.bounds ?? { ...(board?.position ?? { x: 0, y: 0 }), width: board?.viewport.width ?? 1, height: board?.viewport.height ?? 1 };
  const saved: Fields = { x: String(savedBox.x), y: String(savedBox.y), width: String(savedBox.width), height: String(savedBox.height), title: board?.title ?? "" };
  const scope = JSON.stringify([artifactId, controls.snapshotRef, object ?? board]);
  const project = (operation?: CanvasOperation): Fields => {
    const box = operation?.type === "object.update" ? operation.changes.bounds ?? savedBox : operation?.type === "board.update" ? { ...(operation.position ?? board!.position), width: operation.viewport?.width ?? board!.viewport.width, height: operation.viewport?.height ?? board!.viewport.height } : savedBox;
    return { x: String(box.x), y: String(box.y), width: String(box.width), height: String(box.height), title: operation?.type === "board.update" ? operation.title ?? saved.title : saved.title };
  };
  const keyFor = (operation?: CanvasOperation) => JSON.stringify([scope, Boolean(operation), project(operation)]), key = keyFor(operation);
  const [local, setLocal] = useState<{ key: string; values: Fields; failed: boolean }>(() => ({ key, values: project(operation), failed: false }));
  const values = local.key === key ? local.values : project(operation), failed = local.key === key && local.failed;
  useEffect(() => { onUncheckpointed?.(failed); return () => onUncheckpointed?.(false); }, [failed, onUncheckpointed]);
  const replace = (next?: CanvasOperation) => { const draft = checkpoint?.draft ?? [], index = draft.findIndex(matches); return index < 0 ? next ? [...draft, next] : draft : draft.flatMap((operation, current) => current === index ? next ? [next] : [] : [operation]); };
  const change = (field: keyof Fields, value: string) => {
    const next = { ...values, [field]: value }; if (!checkpoint) return;
    try {
      if (![next.x, next.y, next.width, next.height].every(value => value.trim())) throw new Error("Enter a numeric value");
      const bounds = { x: Number(next.x), y: Number(next.y), width: Number(next.width), height: Number(next.height) };
      const updated = canvasOperationSchema.parse(object ? { type: "object.update", objectId: object.id, changes: { ...(operation?.type === "object.update" ? operation.changes : {}), bounds } } : { ...(operation?.type === "board.update" ? operation : {}), type: "board.update", boardId: board!.id, title: next.title, position: { x: bounds.x, y: bounds.y }, viewport: { width: bounds.width, height: bounds.height } });
      const draft = canvasOperationsSchema.parse(replace(updated)); setLocal({ key: keyFor(updated), values: next, failed: false }); void controls.changeCanvas({ ...checkpoint, draft });
    } catch { setLocal({ key, values: next, failed: true }); }
  };
  const cancel = () => {
    if (!checkpoint) return; let retained: CanvasOperation | undefined;
    if (operation?.type === "object.update") { const changes = { ...operation.changes }; delete changes.bounds; if (Object.keys(changes).length) retained = canvasOperationSchema.parse({ ...operation, changes }); }
    else if (operation?.type === "board.update") { const changes = { ...operation }; delete changes.position; delete changes.viewport; delete changes.title; if (changes.pageId) retained = canvasOperationSchema.parse(changes); }
    const remaining = replace(retained); setLocal({ key: keyFor(retained), values: saved, failed: false }); void controls.changeCanvas({ ...checkpoint, draft: remaining.length ? remaining : undefined });
  };
  return <fieldset disabled={!controls.current || controls.busy || controls.pending} className="space-y-4 p-4"><legend className="sr-only">{copy.properties}</legend><p className="text-sm font-medium">{board?.title ?? (object?.kind === "text" || object?.kind === "note" ? object.text.slice(0, 100) : object?.kind === "drawing" ? copy.draw : object ? copy[object.kind] : copy.choose)}</p>
    {board && <label className="block space-y-1 text-sm"><span>{copy.name}</span><input aria-label={copy.name} value={values.title} maxLength={250} className="min-h-[44px] w-full rounded-md border bg-background px-2" onChange={event => change("title", event.target.value)} /></label>}
    <div className="grid grid-cols-2 gap-2">{([['x', 'X'], ['y', 'Y'], ['width', copy.width], ['height', copy.height]] as const).map(([field, label]) => <label key={field} className="block space-y-1 text-sm"><span>{formatCopy(copy.pixelLabel, { label })}</span><input type="number" inputMode="decimal" aria-label={label} value={values[field]} className="min-h-[44px] w-full rounded-md border bg-background px-2" onChange={event => change(field, event.target.value)} /></label>)}</div>
    {failed && <p role="alert" className="text-xs text-destructive">{copy.unsupported}</p>}
    <div className="flex gap-2"><Button type="button" variant="outline" className="min-h-[44px]" onClick={cancel}>{copy.cancel}</Button><Button type="button" className="min-h-[44px]" disabled={failed || !checkpoint?.draft} onClick={() => { if (checkpoint?.draft) void controls.canvas(artifactId, checkpoint.draft); }}>{copy.save}</Button></div>
  </fieldset>;
}
