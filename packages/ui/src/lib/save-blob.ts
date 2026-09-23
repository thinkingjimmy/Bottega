/**
 * [INPUT]: Depends on @ai-chat/shell-bridge getShell for the optional native file capability, the DOM anchor download, React state and the shared saveFailed text.
 * [OUTPUT]: Provides saveBlob (native chunked save/share inside the mobile shell, browser download elsewhere), saveBlobUrl, isSaveCancelled and useSaveLink for existing `<a download>` links.
 * [POS]: The one download entry for Web-rendered surfaces (mobile W8); a WebView ignores `<a download>`, so every host-visible save goes through here.
 */
import { useState, type MouseEvent } from "react";
import { getShell, ShellError } from "@ai-chat/shell-bridge";
import { useUiText } from "./ui-text";
export type SaveBlobOptions = { share?: boolean; signal?: AbortSignal };
/* A dismissed native save sheet is the user's decision, not a failure to report. */
export const isSaveCancelled = (error: unknown) =>
  error instanceof ShellError && error.code === "cancelled" || error instanceof DOMException && error.name === "AbortError";
export async function saveBlob(blob: Blob, name: string, { share = false, signal }: SaveBlobOptions = {}): Promise<void> {
  const files = getShell()?.files;
  if (files) {
    const transfer = { name, mime: blob.type || "application/octet-stream", blob, signal };
    return share ? files.share(transfer) : files.save(transfer);
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: name, rel: "noopener" }).click();
  /* The browser reads the URL after the click returns; revoking at once can cancel the download. */
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
/** Saves the bytes behind an object URL the caller already owns and keeps owning. */
export async function saveBlobUrl(url: string, name: string, options?: SaveBlobOptions) {
  const response = await fetch(url, { signal: options?.signal });
  return saveBlob(await response.blob(), name, options);
}
/**
 * Keeps an `<a href download>` native (context menu, drag, browser download) and takes the click over only inside a shell
 * with the file capability; `failed` is a sentence to render next to the link, never set for a cancelled save sheet.
 */
export function useSaveLink(name: string) {
  const [failed, setFailed] = useState(false), label = useUiText("saveFailed", "Could not save the file. Try again.");
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || !getShell()?.files) return;
    event.preventDefault(); setFailed(false);
    void saveBlobUrl(event.currentTarget.href, name).catch(error => { if (!isSaveCancelled(error)) setFailed(true); });
  };
  return { onClick, failed: failed ? label : null };
}
