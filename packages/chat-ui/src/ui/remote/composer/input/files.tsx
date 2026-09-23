/**
 * [INPUT]: Retained browser files, processing/upload state, per-file support facts, locale and owner-controlled actions.
 * [OUTPUT]: Provides RemoteDraftFiles and draftFileFailure — the desktop's 80px image tiles (hover ×, sketch mark, lightbox with a shell-aware save) with Web state as an overlay: a placeholder with a spinner while the image is prepared (× cancels), dimmed while uploading, red with a retry mark when upload failed or expired (draftFileFailure names which), red with the reason when the image was rejected or must be picked again (draftFileProblem names it).
 * [POS]: Shared remote attachment strip for images; other files are chips inside the editor.
 */
import { useState, type ComponentProps } from "react";
import { ImageIcon, ImageOffIcon, PencilIcon, RotateCcw } from "lucide-react";
import { AttachmentTile, AttachmentAction, AttachmentActions, AttachmentGroup } from "@ai-chat/ui/components/ui/attachment";
import { PromptInputHeader } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { Dialog, DialogContent, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { cn } from "@ai-chat/ui/lib/utils";
import { useSaveLink } from "@ai-chat/ui/lib/save-blob";
import type { ComposerDraft, DraftFile } from "../../../../platform/remote/input/draft";
import { useComposerTranslation } from "../../../composer/controls/copy/translation";
import { remoteInputCopy } from "../copy";
import { isImageFile } from "./editor";
/** The one sentence for a file that cannot be sent as it stands: rejected by the image pipeline, or lost when the page reloaded. */
export const draftFileProblem = (file: DraftFile, copy: ReturnType<typeof remoteInputCopy>) => file.state === "reselect" ? copy.reselect : file.state !== "rejected" ? null
  : file.error === "attachment-size" ? copy.imageTooLarge : file.error === "attachment-dimensions" ? copy.imageDimensions : copy.unsupportedFormat;
/** A failed tile retries on tap; an upload retired at 20 h says so instead of reading as a transfer error. */
export const draftFileFailure = (file: DraftFile, copy: ReturnType<typeof remoteInputCopy>) => file.error === "attachment-expired" ? copy.expired : copy.failed;
export function RemoteDraftFiles({ draft, locale, disabled, unsupported, remove, retry, reselect, edit, previewId, onPreview }: {
  draft: ComposerDraft; locale: string; disabled: boolean; unsupported(file: DraftFile): string | null;
  remove(id: string): void; retry(file: DraftFile): void; reselect(file: DraftFile): void; edit(anchor: HTMLElement, id: string): void;
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
        const problem = draftFileProblem(file, copy), reason = problem ?? unsupported(file), failed = file.state === "failed";
        const uploading = file.state === "uploading", processing = file.state === "processing";
        const state = failed ? draftFileFailure(file, copy) : uploading ? copy.uploading : processing ? copy.processing : reason;
        const name = file.file.name, bad = failed || Boolean(reason);
        /* A tile lost on reload reopens the picker; one still processing or rejected has nothing to preview. */
        const action: Omit<ComponentProps<"button">, "children"> = file.state === "reselect" ? { "aria-label": copy.reselect, disabled, onClick: () => reselect(file) }
          : problem || processing ? { "aria-label": state ?? name, "aria-disabled": true, className: "cursor-default" }
          : { className: file.sketch && !disabled ? "cursor-pointer" : undefined, "aria-label": file.sketch && !disabled ? t("sketch.edit") : copy.preview.replace("{name}", name),
            onClick: event => { if (file.sketch && !disabled) edit(event.currentTarget, file.id); else setLightbox(file); } };
        return <AttachmentTile key={file.id} image name={name} data-file-state={bad ? "bad" : file.state} title={state ?? undefined}
          className={cn(bad && "border-destructive ring-2 ring-destructive/20")} mediaClassName={uploading ? "opacity-45" : undefined}
          removeLabel={copy.remove.replace("{name}", name)} disabled={disabled} onRemove={() => remove(file.id)} action={action}
          thumbnail={file.preview ? <><img src={file.preview} alt="" className="size-full rounded-[inherit] object-cover" />{Boolean(file.sketch) && <PencilIcon aria-hidden="true" className="chat-remote-sketch-mark" />}</>
            : <span aria-hidden="true" className="grid size-full place-items-center rounded-[inherit] bg-muted text-muted-foreground">{problem ? <ImageOffIcon className="size-5" /> : <ImageIcon className="size-5 opacity-40" />}</span>}>
          {processing && <span className="chat-remote-tile-progress" aria-hidden="true"><Spinner className="size-5" /></span>}
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
      {shown && <PreviewSave key={shown.preview} url={shown.preview} name={shown.file.name} label={copy.download} />}
    </DialogContent></Dialog>
  </>;
}
/* Keyed by file so a failure sentence never outlives the preview it belongs to. */
function PreviewSave({ url, name, label }: { url: string; name: string; label: string }) {
  const save = useSaveLink(name);
  return <><a href={url} download={name} onClick={save.onClick}>{label}</a>{save.failed && <p role="alert" className="text-destructive text-sm">{save.failed}</p>}</>;
}
