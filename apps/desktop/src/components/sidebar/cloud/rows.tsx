/**
 * [INPUT]: Depends on authority-free sidebar heads, current devices, existing row controls and locale.
 * [OUTPUT]: Adds mirror rows (drop slots, never drag sources), device badges to existing Chat lists.
 * [POS]: Sidebar reading/navigation only; clicking a mirror never claims execution or creates an App role.
 */
import { Link, useLocation } from "react-router";
import { Clock3, CircleQuestionMark, LoaderCircle, CircleAlert } from "lucide-react";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatCatalogFacts } from "@ai-chat/chat-ui/model";
import { chatNavigationCopy } from "@ai-chat/chat-ui/navigation-copy";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import { SidebarRowMark, sidebarSubRowClass } from "@ai-chat/ui/components/workspace/row";
import { SidebarMenuItem, SidebarMenuButton, SidebarMenuSubItem, SidebarMenuSubButton } from "@ai-chat/ui/components/ui/sidebar";
import { SidebarRowTag } from "@ai-chat/ui/components/workspace/row";
import { executionCopy } from "@ai-chat/chat-ui/execution-copy";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useChatActivity } from "@/lib/chat-activity-store";
import { useCloudSidebar } from "./context";
import type { ChatRowDropProps } from "../reorder/row-props";
import { ChatDropIndicator, chatRowDropAttributes } from "../chat/chat-thread-item";

export function ChatExecutorBadge({ chatId }: { chatId: string }) {
  const { heads, devices, deviceId } = useCloudSidebar(), { i18n } = useAppTranslation();
  const head = heads.find(value => value.chat.id === chatId);
  if (!head?.executorDeviceId || head.executorDeviceId === deviceId) return null;
  return <SidebarRowTag>{devices.find(device => device.deviceId === head.executorDeviceId)?.name ?? executionCopy(i18n.language).computer}</SidebarRowTag>;
}
export function CloudChatRow({ head, facts, project = false, badge, reorder }: { head: CloudChatHead; facts?: ChatCatalogFacts; project?: boolean; badge?: string;
  /** Mirrors define drop slots but are never dragged: no local record can carry the key. */
  reorder?: ChatRowDropProps }) {
  const { pathname } = useLocation(), { t, i18n } = useAppTranslation(), copy = chatNavigationCopy(i18n.language);
  const Item = project ? SidebarMenuSubItem : SidebarMenuItem, Button = project ? SidebarMenuSubButton : SidebarMenuButton;
  const unread = useChatActivity(head.chat.id);
  const activity = unread ?? (head.activity === "done" || head.activity === "failed" ? "idle" : head.activity ?? (head.openTurnId ? "unknown" : "idle"));
  const path = `/chat/${encodeURIComponent(head.chat.id)}`;
  return <Item ref={reorder?.itemRef} {...chatRowDropAttributes(reorder)}><ChatDropIndicator edge={reorder?.dropEdge ?? null} variant={project ? "sub" : "root"} /><Button asChild isActive={pathname === path} className={project ? sidebarSubRowClass : undefined}>
    <Link to={path} data-cloud-chat={head.chat.id} title={backendLabel(head.chat.agent)}>
      <SidebarRowMark>{activity === "waiting" ? <CircleQuestionMark className="size-4" aria-label={copy.waiting} /> : activity === "running" || activity === "saving"
        ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-label={activity === "saving" ? copy.savingReply : copy.running} /> : activity === "unknown"
          ? <Clock3 className="size-4" aria-label={copy.unknown} /> : activity === "done" ? <span className="size-2 rounded-full bg-blue-500" aria-label={copy.completed} /> : activity === "failed" ? <CircleAlert className="size-4 text-yellow-500" aria-label={copy.executionFailed} /> : <AgentBackendIcon backend={head.chat.agent} className="size-4" />}</SidebarRowMark>
      <span className="min-w-0 flex-1 truncate">{(facts ? facts.title : head.chat.title) ?? t("common.chats")}</span>
      {badge && <SidebarRowTag>{badge}</SidebarRowTag>}<ChatExecutorBadge chatId={head.chat.id} />
    </Link>
  </Button></Item>;
}
