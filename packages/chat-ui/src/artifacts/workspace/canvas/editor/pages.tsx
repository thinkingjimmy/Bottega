/**
 * [INPUT]: Normalized page summaries, current page, input-safe edit/navigation availability and closed host page-management callbacks.
 * [OUTPUT]: Guarded page selection/CRUD dialogs with visible limits, confirmation and retained failed input.
 * [POS]: Page chrome; pages remain distinct from boards and saved versions.
 */
import { useState } from "react";
import { ChevronDown, Check, Plus, Copy, Pencil, Trash2 } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@ai-chat/ui/components/ui/popover";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@ai-chat/ui/components/ui/dialog";
import { useArtifactHost } from "../../../context";
import { canvasCopy } from "./copy";
export type CanvasPageView = { id: string; title: string; boardCount: number; objectCount: number };
export type PageAction = "create" | "rename" | "duplicate" | "delete";
export function CanvasPages({ pages, pageId, canEdit, canNavigate = true, reason, busy, choose, manage }: { pages: CanvasPageView[]; pageId: string; canEdit: boolean; canNavigate?: boolean; reason?: string; busy: boolean; choose(id: string): void; manage(action: PageAction, pageId: string, title: string): Promise<boolean> }) {
  const copy = canvasCopy(useArtifactHost()!.locale), page = pages.find(page => page.id === pageId) ?? pages[0], [open, setOpen] = useState(false), [action, setAction] = useState<PageAction | null>(null), [name, setName] = useState("");
  const labels = { create: copy.newPage, rename: copy.renamePage, duplicate: copy.duplicatePage, delete: copy.deletePage };
  const launch = (action: PageAction) => { setOpen(false); setAction(action); setName(action === "create" ? `${copy.page} ${pages.length + 1}` : page?.title ?? ""); };
  const submit = async () => { if (action && page && await manage(action, page.id, name.trim())) setAction(null); };
  return <>
    <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" variant="ghost" className="min-h-[44px] max-w-40 shrink-0 gap-1 px-2" aria-label={copy.page} data-canvas-page=""><span className="truncate">{page?.title ?? copy.page}</span><ChevronDown className="size-3 shrink-0" /></Button></PopoverTrigger><PopoverContent align="start" className="w-64 p-1" data-canvas-chrome="">
      {pages.map(value => <Button key={value.id} type="button" variant={value.id === pageId ? "secondary" : "ghost"} className="min-h-[44px] w-full justify-start" aria-pressed={value.id === pageId} data-canvas-page-id={value.id} disabled={!canNavigate} title={!canNavigate ? reason : undefined} onClick={() => { choose(value.id); setOpen(false); }}><span className="min-w-0 flex-1 truncate">{value.title}</span><span className="text-xs text-muted-foreground">{value.boardCount} / {value.objectCount}</span>{value.id === pageId && <Check className="size-4 shrink-0" />}</Button>)}
      <div className="my-1 border-t" />
      {([['create', Plus], ['rename', Pencil], ['duplicate', Copy], ['delete', Trash2]] as const).map(([operation, Icon]) => <Button key={operation} type="button" variant="ghost" className="min-h-[44px] w-full justify-start" disabled={busy || !canEdit || (operation === "create" || operation === "duplicate") && pages.length >= 16 || operation === "delete" && pages.length < 2} title={(operation === "create" || operation === "duplicate") && pages.length >= 16 ? copy.pageLimit : reason} onClick={() => launch(operation)}><Icon className="size-4" />{labels[operation]}</Button>)}
      {!canEdit && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">{reason ?? copy.unavailable}</p>}
    </PopoverContent></Popover>
    <Dialog open={action !== null} onOpenChange={value => { if (!value && !busy) setAction(null); }}><DialogContent className="max-w-sm" data-canvas-chrome=""><DialogTitle>{action ? labels[action] : copy.page}</DialogTitle><DialogDescription>{action === "delete" ? `${page?.title ?? ""} · ${copy.restoreHint}` : copy.name}</DialogDescription>
      {action === "delete" ? <p>{copy.deleteConfirm}</p> : <label className="flex flex-col gap-2"><span>{copy.name}</span><input autoFocus value={name} maxLength={250} aria-label={copy.name} className="min-h-[44px] rounded-md border bg-background px-3" disabled={busy} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && name.trim()) { event.preventDefault(); void submit(); } }} /></label>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => setAction(null)}>{copy.cancel}</Button><Button type="button" variant={action === "delete" ? "destructive" : "default"} className="min-h-[44px]" disabled={busy || !canEdit || action !== "delete" && !name.trim()} onClick={() => void submit()}>{action === "delete" ? copy.deletePage : copy.save}</Button></div>
    </DialogContent></Dialog>
  </>;
}
