/**
 * [INPUT]: Verified message-file preview identity, scoped workspace native actions, toast feedback and localized copy.
 * [OUTPUT]: A single Reveal in Finder header action with explicit failure feedback.
 * [POS]: File-preview header control; native targets are revalidated by main on every action.
 */
import { useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { toast } from "@ai-chat/ui/components/ui/sonner";
import { actOnWorkspaceFileLink } from "@/lib/clients/workspace-files-client";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import type { SidePanelState } from "../runtime/chat-session-model";

type Preview = Extract<SidePanelState, { kind: "workspace-preview" }>;
export function MessageFileActions({ preview }: { preview: Preview }) {
  const { t } = useAppTranslation();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const file = preview.localFile;
  if (!file) return null;
  const reveal = async () => {
    if (pending.current || !file.workspaceIdentity) return;
    pending.current = true;
    setBusy(true);
    try { await actOnWorkspaceFileLink({ ...file, workspaceIdentity: file.workspaceIdentity, action: "reveal" }); }
    catch { toast.error(t("chat.sidePanel.file.actionFailed")); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Button
    className="shrink-0 [-webkit-app-region:no-drag]"
    data-message-file-actions=""
    variant="ghost"
    size="sm"
    disabled={busy || !file.workspaceIdentity}
    onClick={() => void reveal()}
  ><FolderOpen className="size-4" />{t("chat.sidePanel.file.reveal")}</Button>;
}
