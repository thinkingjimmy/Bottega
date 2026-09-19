/**
 * [INPUT]: Main-owned Base resolution, confirmed Chat incarnation and the native Base platform.
 * [OUTPUT]: Base resolution/creation/editor ports consumed by the shared Chat panel.
 * [POS]: Desktop authority adapter; no cloud response creates a local filesystem grant.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { PanelBaseState, PanelBaseProps } from "@ai-chat/chat-ui/side-panel/host/ports";
import { useBasesNavigation, useBaseSnapshots } from "@/components/providers/bases-provider";
import { ownerKeyOf } from "@ai-chat/base-ui/model/owner-key";
const BaseWorkbench = lazy(() => import("@/components/bases/base-workbench").then(module => ({ default: module.BaseWorkbench })));
export function usePanelBase(head: CloudChatHead | null, cycle: number): PanelBaseState {
  const { resolveForSection, movedOwners } = useBasesNavigation(), { snapshots } = useBaseSnapshots();
  const chatId = head?.chat.id ?? "", incarnationId = head?.chat.incarnationId ?? "", [retry, setRetry] = useState(0);
  const eligible = head?.chat.classification.conversationKind === "ordinary";
  const key = `${chatId}/${incarnationId}/${cycle}/${retry}`;
  const [state, setState] = useState<{ key: string; target: Awaited<ReturnType<typeof resolveForSection>> | null; error: boolean } | null>(null);
  useEffect(() => {
    if (!eligible) return;
    let active = true;
    void resolveForSection(chatId).then(target => { if (active) setState({ key, target, error: false }); })
      .catch(() => { if (active) setState({ key, target: null, error: true }); });
    return () => { active = false; };
  }, [chatId, eligible, key, resolveForSection]);
  const current = state?.key === key ? state : null, resolved = current?.target;
  const owner = resolved ? movedOwners[resolved.ownerKey] ?? resolved.ownerKey : null;
  const snapshot = owner ? snapshots[owner] : null;
  const target = resolved && owner && (resolved.status === "healthy" || snapshot) ? { baseId: owner, project: owner.startsWith("project:") } : null;
  return { target, resolved: Boolean(current), error: current?.error ?? false, promoted: null, retry: () => setRetry(value => value + 1) };
}
export function usePanelBaseCreation() {
  const { ensure } = useBasesNavigation();
  return (head: CloudChatHead) => ensure(ownerKeyOf({ kind: "chat", chatId: head.chat.id, incarnationId: head.chat.incarnationId }));
}
export function DesktopPanelBase({ targetBaseId, visible, chatId, incarnationId }: PanelBaseProps) {
  return <div hidden={!visible} role="tabpanel" id="panel-tab-base" aria-labelledby="panel-tab-base-trigger" className="flex min-h-0 flex-1 flex-col">
    {targetBaseId && <Suspense fallback={null}><BaseWorkbench key={targetBaseId} ownerKey={targetBaseId} compact attachmentOwner={{ chatId, incarnationId }} /></Suspense>}
  </div>;
}
