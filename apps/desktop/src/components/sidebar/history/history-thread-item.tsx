"use client";

/**
 * [INPUT]: Depends on router, shared history identity, History/Projects Providers, i18n, shared Sidebar rename and hover interaction, Agent backend identity, and sidebar-row geometry
 * [OUTPUT]: Provides HistoryThreadItem with source logo, sliding title, modal rename, and direct archive actions; all mutations stay in the product overlay and never write CLI source
 * [POS]: ForeignHistory line in the sidebar/history; The visual and interactive interface is the same as the chat/chat-thread-item, with only the data side of HistoryProvider
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Archive, MoreHorizontal, Pencil } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@ai-chat/ui/components/ui/sidebar";
import {
  historyBackend,
  type ForeignHistorySummary,
} from "../../../../shared/history-import-ipc";
import {
  SidebarRowMark,
  SidebarRowTitle,
  sidebarSubRowClass,
} from "../sidebar-row";
import {
  subMenuActionClass,
} from "../chat/chat-thread-item";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import { useHistory } from "@/components/providers/history/history-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { projectDraftRoute } from "@/lib/draft-route";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  SidebarRenameDialog,
  useSidebarRenameMenu,
} from "../rename/sidebar-rename-dialog";

export function HistoryThreadItem({ history, active }: {
  history: ForeignHistorySummary;
  active: boolean;
}) {
  const { t } = useAppTranslation();
  const { renameSession, setSessionArchived } = useHistory();
  const { projects } = useProjects();
  const navigate = useNavigate();
  const [renameOpen, setRenameOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const renameMenu = useSidebarRenameMenu(() => setRenameOpen(true));

  /* 来源只说一遍。行首 logo 已经把「这是 Codex 的会话」说完，行尾再挂一枚
     文字标签就是同一句话的第二种说法——而两种说法必然有一种是多余的。
     同为一条会话，不该因为来路不同而换一套视觉语法：动作面（重命名/归档）
     也与 chat 行同构，只是全部落在产品侧 overlay，CLI 源文件永远只读。 */
  const backend = historyBackend(history.sourceKind);

  const handleArchive = async () => {
    setBusy(true);
    try {
      await setSessionArchived(history.opaqueId, true);
      /* 与 chat 行同律：归档的是这条会话而不是它所在的 Project，
         把用户留在原 Project 的空白页上。 */
      if (active) navigate(projectDraftRoute(history.projectId, projects));
    } catch {
      // 失败文案由 HistoryProvider 投影为 warning，此处只收敛状态
    } finally {
      setBusy(false);
    }
  };

  const requestArchive = () => {
    if (!busy) void handleArchive();
  };

  return (
    <SidebarMenuSubItem className="w-full">
      <SidebarMenuSubButton asChild className={sidebarSubRowClass} isActive={active}>
        <Link to={`/history/${history.opaqueId}`}>
          <SidebarRowMark>
            <AgentBackendIcon
              backend={backend}
              className="text-sidebar-foreground/55"
              aria-label={backendLabel(backend)}
            />
          </SidebarRowMark>
          <SidebarRowTitle>{history.title}</SidebarRowTitle>
        </Link>
      </SidebarMenuSubButton>

      <SidebarMenuAction
        className={subMenuActionClass}
        aria-label="归档会话"
        disabled={busy}
        onClick={requestArchive}
      >
        <Archive />
      </SidebarMenuAction>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            {...renameMenu.triggerProps}
            className={`right-7 ${subMenuActionClass}`}
            aria-label="更多操作"
          >
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align="start"
          className="w-max min-w-0"
          onCloseAutoFocus={renameMenu.onMenuCloseAutoFocus}
        >
          <DropdownMenuItem
            className="whitespace-nowrap"
            onSelect={renameMenu.requestOpen}
          >
            <Pencil />
            {t("history.rename")}
          </DropdownMenuItem>
          {/* 归档可回收，故用常规色：红留给不可撤销的动作。 */}
          <DropdownMenuItem
            className="whitespace-nowrap"
            onSelect={requestArchive}
          >
            <Archive />
            归档
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SidebarRenameDialog
        open={renameOpen}
        currentName={history.title}
        title={t("history.renameTitle")}
        description={t("history.renameDescription")}
        maxLength={200}
        onOpenChange={setRenameOpen}
        onRename={(title) => renameSession(history.opaqueId, title)}
        onCloseAutoFocus={renameMenu.onDialogCloseAutoFocus}
      />
    </SidebarMenuSubItem>
  );
}
