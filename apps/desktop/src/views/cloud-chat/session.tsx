/**
 * [INPUT]: Depends on six scoped Chat facades, confirmed portable heads, remote controls and the existing native draft store.
 * [OUTPUT]: Supplies cloud session ports, desktop chrome, artifact authority and read-only recovery to the owning ChatPage renderer, without a suspending boundary between the two execution ports.
 * [POS]: Desktop CloudPlatform session adapter; this module owns no Chat page or column layout.
 */
import type { ChatPageRenderer } from "@ai-chat/chat-ui/chat-page";
import { claimActiveChat } from "@/lib/chat-activity-store";
import { MirrorArtifacts } from "@/components/chat/artifact/mirror";
import { useNavigate, useSearchParams } from "react-router";
import { useRemoteComposerDraft } from "./remote/draft";
import { executionCopy } from "@ai-chat/chat-ui/execution-copy";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useChatDevices } from "@/lib/cloud/chat/devices";
import type { desktopChatSources } from "@/lib/cloud/chat/sources";
import { ContinuationBanner, useContinuation, type ContinuationDraft } from "./continuation";
import { DesktopFactsEntry } from "./facts";
import { SourceApp } from "./source-app";
import { restoreArchiveTargets } from "@/lib/archive-client";
import { useEffect, useState } from "react";
import { useDesktopPanelServices } from "./panel/platform";
import { useSidebar } from "@ai-chat/ui/components/ui/sidebar";
import { isApplePlatform } from "@/lib/platform";
import { Ellipsis } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@ai-chat/ui/components/ui/popover";
import "@ai-chat/chat-ui/styles.css";
import "@ai-chat/chat-ui/remote-styles.css";
/* The shared page is the other half of this port. It is fetched as soon as this module evaluates —
   the route warms both at idle — and kept resolved, because a `lazy` boundary here would blank the
   columns for a tick every time the reader moves the conversation to another computer. */
let cloudPageChunk: typeof import("@ai-chat/chat-ui/page/cloud") | null = null;
const loadCloudPageChunk = () => import("@ai-chat/chat-ui/page/cloud").then(module => (cloudPageChunk = module));
void loadCloudPageChunk().catch(() => {});
export function DesktopCloudSession({ head, sources, draft, renderPage, focusComposer = false }: { renderPage: ChatPageRenderer; head: CloudChatHead; sources: ReturnType<typeof desktopChatSources>; draft: ContinuationDraft; focusComposer?: boolean }) {
  useEffect(() => claimActiveChat(head.chat.id), [head.chat.id]);
  const navigate = useNavigate(), { i18n, t } = useAppTranslation(), [search] = useSearchParams(), { devices } = useChatDevices();
  const copy = executionCopy(i18n.language), device = devices.find(value => value.deviceId === head.ownerDeviceId);
  const execution = useContinuation(head.chat.id, sources.execution), ordinary = head.chat.classification.conversationKind === "ordinary";
  const remoteDraft = useRemoteComposerDraft(head.chat.id, draft);
  const panels = useDesktopPanelServices(head), { state } = useSidebar();
  const [menuOpen, setMenuOpen] = useState(false), [menuLocked, setMenuLocked] = useState(false);
  const [page, setPage] = useState(cloudPageChunk);
  if (!page && cloudPageChunk) setPage(cloudPageChunk);
  useEffect(() => { if (page) return; let alive = true; void loadCloudPageChunk().then(module => { if (alive) setPage(module); }).catch(() => {}); return () => { alive = false; }; }, [page]);
  /* The frame, not a loading shell: an unresolved chunk keeps the columns and the header it already has. */
  if (!page) return renderPage({ conversation: { empty: false, mounted: false, emptyView: null, fallback: null, transcript: null } });
  const CloudChatSession = page.CloudChatSession;
  return <CloudChatSession renderPage={renderPage} head={head} platform={sources} locale={i18n.language} panels={panels} draft={remoteDraft} focusComposer={focusComposer}
    chrome={{ chrome: "native", collapsedInset: state === "collapsed" ? isApplePlatform() ? "mac" : "compact" : undefined }}
    artifacts={(children, openPanel) => <MirrorArtifacts chatId={head.chat.id} incarnationId={head.chat.incarnationId} locale={i18n.language} openPanel={openPanel}>{children}</MirrorArtifacts>}
    headerActions={<Popover open={menuOpen} onOpenChange={open => { if (open || !menuLocked) setMenuOpen(open); }}><PopoverTrigger asChild><Button size="icon-lg" variant="ghost" aria-label={t("chat.sidePanel.more")}><Ellipsis /></Button></PopoverTrigger>
      <PopoverContent align="end" className="max-h-[80dvh] w-80 overflow-y-auto"><DesktopFactsEntry chatId={head.chat.id} onBlockingChange={setMenuLocked} /></PopoverContent></Popover>}
    notices={head.chat.classification.appId && <SourceApp appId={head.chat.classification.appId} />}
    bindProject={sources.bindProject} targetMessageId={search.get("messageId")}
    restore={head.archivedAt !== null ? async () => { await restoreArchiveTargets([{ kind: "chat", id: head.chat.id }]); } : undefined}
    readOnlyFooter={<ContinuationBanner chatId={head.chat.id} execution={sources.execution} view={execution.view} copy={copy} draft={draft}
      ordinary={ordinary} deviceName={device?.name ?? copy.computer} deviceState={device?.state === "revoked" ? copy.revoked : device?.presenceState === "online" ? copy.online : copy.offline} />}
    navigateToChat={(id, messageId) => navigate(`/chat/${encodeURIComponent(id)}?messageId=${encodeURIComponent(messageId)}`)} />;
}
