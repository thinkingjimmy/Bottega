/**
 * [INPUT]: Persisted original-version feedback targets, trusted geometry and existing checkpoint/composer callbacks.
 * [OUTPUT]: Nearby retained annotation input, numbered feedback and explicit locate/retarget/delete/handoff actions.
 * [POS]: Canvas opinion surface; no feedback or host authority enters the authored frame.
 */
import { useEffect, useRef } from "react";
import { MapPin, Crosshair, Trash2, X } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { DesignCheckpoint, DesignAnchor } from "@ai-chat/cloud-protocol/artifacts/design/review";
import { useArtifactHost } from "../../context";
import { workspaceCopy } from "../copy";
export type AnnotationDraft = NonNullable<DesignCheckpoint["annotation"]>;
export function ContextAnnotation({ draft, boardTitle, width, height, zoom, bounds, busy, change, save, close }: { draft: AnnotationDraft; boardTitle: string; width: number; height: number; zoom: number;
  bounds?: DesignAnchor["bounds"] | null; busy: boolean; change(text: string): void; save(): void; close(): void }) {
  const copy = workspaceCopy(useArtifactHost()!.locale), input = useRef<HTMLTextAreaElement>(null), at = bounds ?? draft.anchor.bounds ?? draft.anchor.region;
  useEffect(() => { input.current?.focus(); }, [draft.id]);
  return <div data-context-annotation={draft.id} className="absolute z-20 flex max-h-[min(320px,45dvh)] w-[min(304px,calc(100vw-48px))] max-w-full flex-col gap-3 rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl"
    style={{ left: Math.max(0, Math.min((at?.x ?? .1) * width * zoom, width * zoom - 304)), top: Math.max(0, Math.min(((at?.y ?? .1) + (at?.height ?? 0)) * height * zoom + 8, height * zoom - 160)) }}>
    <div className="flex min-w-0 items-center gap-1"><div className="min-w-0 flex-1"><p className="truncate text-xs text-muted-foreground">{boardTitle}</p><p className="truncate text-xs font-medium">{draft.anchor.currentText.slice(0, 60) || draft.anchor.selector || copy.region}</p></div><Button type="button" variant="ghost" size="icon" aria-label={copy.closePanel} className="min-h-[44px] min-w-[44px]" onClick={close}><X className="size-4" /></Button></div>
    <textarea ref={input} aria-label={copy.note} maxLength={4096} rows={3} value={draft.text} className="min-h-20 min-w-0 resize-none rounded-md border bg-background p-2 text-sm focus-visible:outline-2 focus-visible:outline-primary" onChange={event => change(event.target.value)} />
    <Button type="button" disabled={busy || !draft.text.trim()} className="min-h-[44px] shrink-0" onClick={save}>{copy.saveComment}</Button>
  </div>;
}
export function FeedbackNotes({ notes, titles, update, locate, retarget, handoff, enabled, busy }: { notes: DesignCheckpoint["notes"]; titles: Record<string, string>;
  update(notes: DesignCheckpoint["notes"]): void; locate(id: string): void; retarget(id: string): void; handoff(action: "draft" | "send"): void; enabled: boolean; busy: boolean }) {
  const host = useArtifactHost()!, copy = workspaceCopy(host.locale);
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
      {!notes.length && <p className="text-sm text-muted-foreground">{copy.choose}</p>}
      {notes.map((note, index) => <article key={note.id} data-feedback-note={note.id} className="space-y-2 rounded-md border p-3"><header className="flex min-w-0 items-center gap-2"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{titles[note.anchor?.boardId ?? ""] ?? copy.board}</p><p className="truncate text-xs text-muted-foreground">{note.anchor?.currentText.slice(0, 80) || note.anchor?.selector || copy.region}</p></div></header>
        <textarea aria-label={`${copy.note} ${index + 1}`} maxLength={4096} value={note.text} rows={3} className="min-h-20 w-full resize-y rounded-md border bg-background p-2 text-sm" onChange={event => update(notes.map(value => value.id === note.id ? { ...value, text: event.target.value } : value))} />
        <div className="flex gap-1"><Button type="button" variant="ghost" size="icon" aria-label={`${copy.locate} ${index + 1}`} title={copy.locate} className="min-h-[44px] min-w-[44px]" onClick={() => locate(note.id)}><MapPin className="size-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label={`${copy.retarget} ${index + 1}`} title={copy.retarget} className="min-h-[44px] min-w-[44px]" disabled={!enabled} onClick={() => retarget(note.id)}><Crosshair className="size-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label={`${copy.remove} ${index + 1}`} title={copy.remove} className="min-h-[44px] min-w-[44px]" onClick={() => update(notes.filter(value => value.id !== note.id))}><Trash2 className="size-4" /></Button></div>
      </article>)}
    </div>
    <footer className="flex shrink-0 flex-wrap gap-2 border-t bg-background p-3"><p className="w-full text-xs text-muted-foreground">{notes.length} {copy.commentCount}</p>{host.followUp && <Button type="button" variant="outline" disabled={!enabled || busy || !notes.some(note => note.text.trim())} className="min-h-[44px]" onClick={() => handoff("draft")}>{copy.draft}</Button>}{host.sendReview && <Button type="button" disabled={!enabled || busy || !notes.some(note => note.text.trim())} className="min-h-[44px]" onClick={() => handoff("send")}>{copy.send}</Button>}</footer>
  </div>;
}
