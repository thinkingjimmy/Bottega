/**
 * [INPUT]: Chat platform facades, confirmed head, host chrome/artifact adapters and panel services.
 * [OUTPUT]: Cloud session adapter supplying shared ChatPage with header, conversation, panel and navigation ports, and forwarding a port swap's composer-focus intent.
 * [POS]: Cloud page adapter; transport, Base authority and navigation effects stay behind platform ports.
 */
import { ChatPage, ChatPageSessionView, type ChatPageRenderer } from "./chat-page";
import { useState, type ComponentProps, type ReactNode } from "react";
import { PanelRight } from "lucide-react";
import { AgentBackendIcon } from "@ai-chat/ui/components/identity/agent";
import { WorkspaceHeader } from "@ai-chat/ui/components/workspace/page";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { ArtifactHost } from "../../artifacts/context";
import { sidePanelCopy } from "../../i18n/side-panel";
import { ConversationModelProvider } from "../conversation/body/model";
import { RemoteConversation } from "../remote/conversation";
import { useChatSidePanel } from "../side-panel/host/panel";
import type { PanelServices } from "../side-panel/host/ports";
type ConversationProps = Omit<ComponentProps<typeof RemoteConversation>, "children" | "onOpenImage" | "onOpenWorkspaceFile" | "layout">;
export type CloudChatPageProps = ConversationProps & {
  panels: PanelServices;
  /** Raised by a host that just swapped this conversation onto another execution port. */
  focusComposer?: boolean;
  chrome?: Pick<ComponentProps<typeof WorkspaceHeader>, "leading" | "chrome" | "collapsedInset">;
  headerActions?: ReactNode;
  notices?: ReactNode;
  navigation?(dirty: boolean, beforeUnloadDirty: boolean): ReactNode;
  artifacts(children: ReactNode, openPanel: ArtifactHost["open"] | undefined): ReactNode;
};
export function CloudChatPage(props: CloudChatPageProps) {
  return <ChatPage session={renderPage => <CloudChatSession {...props} renderPage={renderPage} />} />;
}
export function CloudChatSession(props: CloudChatPageProps & { renderPage: ChatPageRenderer }) {
  return <ConversationModelProvider><CloudChatPageContent {...props} /></ConversationModelProvider>;
}
function CloudChatPageContent({ panels, chrome, headerActions, notices, navigation, artifacts, renderPage, focusComposer, ...conversation }: CloudChatPageProps & { renderPage: ChatPageRenderer }) {
  const { head, platform, locale } = conversation, copy = sidePanelCopy(locale), [remoteDirty, setRemoteDirty] = useState(false);
  const panel = useChatSidePanel(head, platform.transcript, locale, panels);
  const page = <RemoteConversation {...conversation} layout="fill" onDirtyChange={dirty => { setRemoteDirty(dirty); conversation.onDirtyChange?.(dirty); }}
    onOpenImage={panel.eligible ? panel.onOpenImage : undefined} onOpenWorkspaceFile={panel.eligible && platform.capabilities.files ? panel.onOpenWorkspaceFile : undefined}>
    {regions => <ChatPageSessionView renderPage={renderPage} regions={{ ...regions, focusComposer }} containerRef={panel.containerRef} takeover={panel.takeover} notices={notices} panel={panel.element} navigation={navigation?.(panel.dirty, panel.dirty || remoteDirty)} header={<WorkspaceHeader {...chrome} icon={<AgentBackendIcon backend={head.chat.agent} className="size-4 shrink-0" />}
          title={head.chat.title ?? <><span aria-hidden className="block h-3 w-32 animate-pulse rounded bg-muted" /><span className="sr-only">{copy.generatingTitle}</span></>}
          actions={<>{panel.eligible && <Button ref={panel.triggerRef} size="icon" variant="ghost" className="size-8 max-lg:size-11" aria-label={copy.open} onClick={panel.openShell}><PanelRight className="size-4" /></Button>}{headerActions}</>} />} />}
  </RemoteConversation>;
  return artifacts(page, panel.eligible ? panel.onOpenArtifact : undefined);
}
