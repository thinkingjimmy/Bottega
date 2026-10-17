/**
 * [INPUT]: Current page/board, trusted placement geometry and fixed legal image choices; catalog-owned labels use the shared formatCopy formatter.
 * [OUTPUT]: Named text/note/artboard/image insertion through closed CM operations with retained failed fields.
 * [POS]: Canvas insertion dialog; IDs/resources/source bytes remain host-owned.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@ai-chat/ui/components/ui/dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { formatCopy } from "@ai-chat/ui/lib/workbench-copy/format";
import { canvasOperationSchema, type CanvasOperation } from "@ai-chat/cloud-protocol/artifacts/design/canvas/commands";
import type { CanvasRead } from "@ai-chat/cloud-protocol/artifacts/design/canvas/view";
import { useArtifactHost } from "../../../../../context";
import { canvasCopy } from "../../copy";
import type { CanvasPlacement } from "../view";
export function CanvasInsert({ placement, pageId, pageTitle, board, images, busy, create, close }: { placement: CanvasPlacement; pageId: string; pageTitle: string; board?: CanvasRead["boards"][number]; images: CanvasRead["images"]; busy: boolean; create(operation: CanvasOperation): Promise<boolean>; close(): void }) {
  const copy = canvasCopy(useArtifactHost()!.locale), tool = placement.tool, click = placement.box.width < 8 && placement.box.height < 8;
  const [title, setTitle] = useState(tool === "artboard" ? copy.newBoard : tool === "note" ? copy.note : copy.text), [text, setText] = useState(""), [image, setImage] = useState(images[0]?.path ?? ""), [onBoard, setOnBoard] = useState(false), [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(String(click ? tool === "artboard" ? 390 : tool === "note" ? 220 : tool === "image" ? 320 : 240 : placement.box.width)), [height, setHeight] = useState(String(click ? tool === "artboard" ? 844 : tool === "note" ? 160 : tool === "image" ? 240 : 48 : placement.box.height));
  const valid = Number(width) > 0 && Number(width) <= 8000 && Number(height) > 0 && Number(height) <= 8000 && (tool !== "artboard" || Number.isInteger(Number(width)) && Number.isInteger(Number(height)) && Number(width) >= 40 && Number(height) >= 40 && Boolean(title.trim())) && (tool !== "image" || Boolean(image));
  const submit = async () => {
    try {
      const bounds = { ...placement.box, width: Number(width), height: Number(height), ...(onBoard && board ? { x: placement.box.x - board.position.x, y: placement.box.y - board.position.y } : {}) };
      const source = images.find(value => value.path === image);
      const operation = canvasOperationSchema.parse(tool === "artboard" ? { type: "board.create", pageId, title: title.trim(), mode: "fixed", viewport: { width: Number(width), height: Number(height) }, position: { x: placement.box.x, y: placement.box.y } } : { type: "object.create", pageId, ...(onBoard && board ? { boardId: board.id } : {}), object: tool === "image" ? { kind: "image", bounds, source: { kind: "document", path: source!.path, digest: source!.digest }, alt: title } : { kind: tool, bounds, text, style: { "font-family": "system-ui", "font-size": "16px", color: "#252525" } } });
      setFailed(false); if (await create(operation)) close();
    } catch { setFailed(true); }
  };
  return <Dialog open onOpenChange={value => { if (!value && !busy) close(); }}><DialogContent className="max-w-sm" data-canvas-chrome=""><DialogTitle>{tool === "artboard" ? copy.newBoard : tool === "note" ? copy.note : tool === "image" ? copy.image : copy.text}</DialogTitle><DialogDescription>{copy.page} · {pageTitle}</DialogDescription>
    {(tool === "artboard" || tool === "image") && <label className="space-y-1 text-sm"><span>{copy.name}</span><input autoFocus aria-label={copy.name} value={title} maxLength={250} disabled={busy} className="min-h-[44px] w-full rounded-md border bg-background px-3" onChange={event => setTitle(event.target.value)} /></label>}
    {(tool === "text" || tool === "note") && <label className="space-y-1 text-sm"><span>{copy.text}</span><textarea autoFocus aria-label={copy.text} value={text} maxLength={4096} disabled={busy} className="min-h-[96px] w-full rounded-md border bg-background px-3 py-2" onChange={event => setText(event.target.value)} /></label>}
    {tool === "image" && <label className="space-y-1 text-sm"><span>{copy.image}</span><select aria-label={copy.image} value={image} disabled={busy} className="min-h-[44px] w-full rounded-md border bg-background px-2" onChange={event => setImage(event.target.value)}>{images.map(value => <option key={value.path} value={value.path}>{value.path.split("/").at(-1)} · {formatCopy(copy.sizeKiB, { size: Math.round(value.bytes / 1024) })}</option>)}</select></label>}
    <div className="grid grid-cols-2 gap-2">{([[copy.width, width, setWidth], [copy.height, height, setHeight]] as const).map(([label, value, change]) => <label key={label} className="space-y-1 text-sm"><span>{formatCopy(copy.pixelLabel, { label })}</span><input type="number" inputMode="decimal" aria-label={label} min={tool === "artboard" ? 40 : 1} max={8000} value={value} disabled={busy} className="min-h-[44px] w-full rounded-md border bg-background px-2" onChange={event => change(event.target.value)} /></label>)}</div>
    {board && tool !== "artboard" && <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" checked={onBoard} disabled={busy} onChange={event => setOnBoard(event.target.checked)} />{copy.artboard} · {board.title}</label>}
    {failed && <p role="alert" className="text-sm text-destructive">{copy.failed}</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={close}>{copy.cancel}</Button><Button type="button" className="min-h-[44px]" disabled={!valid || busy} onClick={() => void submit()}>{copy.create}</Button></div>
  </DialogContent></Dialog>;
}
