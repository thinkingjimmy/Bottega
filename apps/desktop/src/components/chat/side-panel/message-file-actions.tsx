/**
 * [INPUT]: Verified message-file preview identity, scoped workspace native actions, clipboard and localized copy.
 * [OUTPUT]: Open with system app, Reveal in Finder, Copy path and Retry controls with explicit failure feedback.
 * [POS]: File-preview toolbar; native targets are revalidated by main on every action.
 */
import { useRef, useState } from "react";
import { Copy, ExternalLink, FolderOpen, RotateCw } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { actOnWorkspaceFileLink } from "@/lib/clients/workspace-files-client";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import type { SidePanelState } from "../runtime/chat-session-model";

type Preview = Extract<SidePanelState, { kind: "workspace-preview" }>;
export function MessageFileActions({ preview, retry }: { preview: Preview; retry(): void }) {
  const { t } = useAppTranslation();
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [copied, setCopied] = useState(false);
  const pending = useRef(false);
  const file = preview.localFile;
  if (!file) return null;
  const run = async (action: "open" | "reveal") => {
    if (pending.current || !file.workspaceIdentity) return;
    pending.current = true;
    setBusy(true); setFailed(false);
    try { await actOnWorkspaceFileLink({ ...file, workspaceIdentity: file.workspaceIdentity, action }); }
    catch { setFailed(true); }
    finally { pending.current = false; setBusy(false); }
  };
  const copy = () => {
    let path = file.href;
    try { path = decodeURIComponent(/^file:/i.test(path) ? new URL(path).pathname : path.split("#")[0]!).replace(/:\d+(?::\d+)?$/, ""); }
    catch { /* Keep the original reference available when its encoding is invalid. */ }
    void navigator.clipboard.writeText(path).then(() => setCopied(true)).catch(() => setFailed(true));
  };
  return <div className="shrink-0 border-b px-3 py-2" data-message-file-actions="">
    <div className="flex flex-wrap items-center gap-1">
      <Button variant="ghost" size="sm" disabled={busy || !file.workspaceIdentity} onClick={() => void run("open")}><ExternalLink className="size-4" />{t("chat.sidePanel.file.open")}</Button>
      <Button variant="ghost" size="sm" disabled={busy || !file.workspaceIdentity} onClick={() => void run("reveal")}><FolderOpen className="size-4" />{t("chat.sidePanel.file.reveal")}</Button>
      <Button variant="ghost" size="icon-sm" title={t(copied ? "chat.sidePanel.file.copied" : "chat.sidePanel.file.copyPath")} aria-label={t(copied ? "chat.sidePanel.file.copied" : "chat.sidePanel.file.copyPath")} onClick={copy}><Copy className="size-4" /></Button>
      {preview.status === "error" && <Button variant="ghost" size="sm" disabled={busy} onClick={retry}><RotateCw className="size-4" />{t("chat.sidePanel.file.retry")}</Button>}
    </div>
    {failed && <p role="alert" className="px-2 pt-1 text-xs text-destructive">{t("chat.sidePanel.file.actionFailed")}</p>}
    {copied && <span role="status" className="sr-only">{t("chat.sidePanel.file.copied")}</span>}
  </div>;
}
