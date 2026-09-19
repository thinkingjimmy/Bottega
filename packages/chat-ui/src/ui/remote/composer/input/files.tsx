/**
 * [INPUT]: Retained browser files, upload state, per-file support facts, locale and owner-controlled actions.
 * [OUTPUT]: Provides RemoteDraftFiles — the desktop's 80px image tiles (hover ×, sketch mark, lightbox) with Web upload state as an overlay: dimmed while uploading, red with a retry mark when it failed or the Agent cannot take it.
 * [POS]: Shared remote attachment strip for images; other files are chips inside the editor.
 */
import { useState } from "react";
import { PencilIcon, RotateCcw } from "lucide-react";
import { AttachmentTile, AttachmentAction, AttachmentActions, AttachmentGroup } from "@ai-chat/ui/components/ui/attachment";
import { PromptInputHeader } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { Dialog, DialogContent, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { cn } from "@ai-chat/ui/lib/utils";
import type { ComposerDraft, DraftFile } from "../../../../platform/remote/input/draft";
import { useComposerTranslation } from "../../../composer/controls/copy/translation";
import { remoteInputCopy } from "../copy";
import { isImageFile } from "./editor";
export function RemoteDraftFiles({ draft, locale, disabled, unsupported, remove, retry, edit, previewId, onPreview }: {
  draft: ComposerDraft; locale: string; disabled: boolean; unsupported(file: DraftFile): string | null;
  remove(id: string): void; retry(file: DraftFile): void; edit(anchor: HTMLElement, id: string): void;
  previewId: string | null; onPreview(id: string | null): void;
}) {
  const t = useComposerTranslation(locale), copy = remoteInputCopy(locale);
  const images = draft.files.filter(isImageFile), preview = draft.files.find(file => file.id === previewId) ?? null;
  const [lightbox, setLightbox] = useState<DraftFile | null>(null);
  const shown = preview ?? lightbox;
  if (!images.length && !shown) return null;
  return <>
    {images.length > 0 && <PromptInputHeader className="pb-0" aria-label={copy.attach}><AttachmentGroup>
      {images.map(file => {
        const reason = unsupported(file), failed = file.state === "failed", uploading = file.state === "uploading";
        const state = failed ? copy.failed : uploading ? copy.uploading : reason;
        const name = file.file.name;
        return <AttachmentTile key={file.id} image name={name} data-file-state={failed || reason ? "bad" : file.state} title={state ?? undefined}
          className={cn((failed || reason) && "border-destructive ring-2 ring-destructive/20")} mediaClassName={uploading ? "opacity-45" : undefined}
          removeLabel={copy.remove.replace("{name}", name)} disabled={disabled} onRemove={() => remove(file.id)}
          action={{ className: file.sketch && !disabled ? "cursor-pointer" : undefined,
            "aria-label": file.sketch && !disabled ? t("sketch.edit") : copy.preview.replace("{name}", name),
            onClick: event => { if (file.sketch && !disabled) edit(event.currentTarget, file.id); else setLightbox(file); } }}
          thumbnail={<><img src={file.preview} alt="" className="size-full rounded-[inherit] object-cover" />{Boolean(file.sketch) && <PencilIcon aria-hidden="true" className="chat-remote-sketch-mark" />}</>}>
          {uploading && <span className="chat-remote-tile-progress" aria-hidden="true"><Spinner className="size-5" />
            <span className="chat-remote-tile-bar"><i style={{ width: `${Math.round(100 * (file.progress?.bytes ?? 0) / Math.max(1, file.progress?.total || file.file.size))}%` }} /></span></span>}
          {state && <span role="status" className="sr-only">{state}</span>}
          {failed && <AttachmentActions className="absolute right-1 bottom-1">
            <AttachmentAction aria-label={copy.retry} size="icon-sm" variant="default" disabled={disabled} className="relative rounded-full border-background shadow-sm after:absolute after:-inset-2.5 after:content-['']" onClick={() => retry(file)}><RotateCcw /></AttachmentAction>
          </AttachmentActions>}
        </AttachmentTile>;
      })}
    </AttachmentGroup></PromptInputHeader>}
    <Dialog open={Boolean(shown)} onOpenChange={open => { if (!open) { setLightbox(null); onPreview(null); } }}><DialogContent><DialogTitle>{shown?.file.name}</DialogTitle>
      {shown && isImageFile(shown) && <img src={shown.preview} alt={shown.file.name} className="max-h-[70dvh] w-full object-contain" />}
      {shown && <a href={shown.preview} download={shown.file.name}>{copy.download}</a>}
    </DialogContent></Dialog>
  </>;
}
