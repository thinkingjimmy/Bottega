/**
 * [INPUT]: Depends on an injected authorized file reader, a logical descriptor and shared copy.
 * [OUTPUT]: Provides a lazy private preview/download (native save inside the mobile shell) with cancellation and deterministic URL cleanup.
 * [POS]: The conversation body's file surface beside message.tsx; partial transfers never become visible URLs.
 */
import { useEffect, useRef, useState } from "react";
import type { BlobDescriptor } from "@ai-chat/cloud-protocol";
import type { TranscriptSource } from "../../../platform/contracts";
import type { ChatCopy } from "../../../i18n/copy";
import { useSaveLink } from "@ai-chat/ui/lib/save-blob";
type FileSource = Pick<TranscriptSource, "file">;
export function TranscriptFile({ chatId, descriptor, name, source, copy, onOpenImage }: { chatId: string; descriptor: BlobDescriptor; name: string; source: FileSource; copy: ChatCopy; onOpenImage?(): void }) {
  const [saved, setView] = useState<{ source?: FileSource; identity?: string; url?: string; busy?: boolean; error?: boolean }>({});
  const identity = `${chatId}:${descriptor.blobId}:${descriptor.sha256}`;
  const view = saved.source === source && saved.identity === identity ? saved : {};
  const current = useRef<{ controller: AbortController; release?: () => void } | null>(null), save = useSaveLink(name);
  useEffect(() => () => { current.current?.controller.abort(); current.current?.release?.(); current.current = null; }, [identity, source]);
  async function open() {
    if (current.current) return;
    const request: { controller: AbortController; release?: () => void } = { controller: new AbortController() }; current.current = request; setView({ source, identity, busy: true });
    try { const result = await source.file(chatId, descriptor, request.controller.signal);
      if (current.current !== request || request.controller.signal.aborted) { result.release(); return; }
      request.release = result.release; setView({ source, identity, url: result.url });
    } catch { if (current.current === request && !request.controller.signal.aborted) { current.current = null; setView({ source, identity, error: true }); } }
  }
  return <div className="chat-file">{view.url ? <>
    {descriptor.mime.startsWith("image/") && <>{onOpenImage ? <button type="button" className="min-h-11" onClick={onOpenImage}><img src={view.url} alt={name} loading="lazy" /></button> : <a href={view.url} target="_blank" rel="noopener noreferrer"><img src={view.url} alt={name} loading="lazy" /></a>}</>}
    <a href={view.url} download={name} onClick={save.onClick}>{copy.download} · {name}</a>{save.failed && <p role="alert">{save.failed}</p>}
  </> : <button type="button" onClick={() => { if (onOpenImage && descriptor.mime.startsWith("image/")) onOpenImage(); else void open(); }} disabled={view.busy} aria-busy={Boolean(view.busy)}>{view.busy ? copy.loading : `${copy.attachment} · ${name}`}</button>}
    {view.error && <p role="alert">{copy.failedFile}</p>}</div>;
}
