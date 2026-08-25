"use client";

/**
 * [INPUT]: Depends on router, shared history summary with historyBackend, HistoryProvider's rename/archiving action, hover of chat-thread-item, code of confidentiality with archiving of education, agent-backends with AgentBackendIcon/backendLabel, Sidebar-row, and sidebar
 * [OUTPUT]: Provides HistoryThreadItem; The "logo + sliding headers + hover archiving/ more menus (renamed, archived) + editing mode" is synchronized with the product chat, and the action is all done on the product side sessionPrefs overlay, without ever writing CLI source
 * [POS]: ForeignHistory line in the sidebar/history; The visual and interactive interface is the same as the chat/chat-thread-item, with only the data side of HistoryProvider
 */

import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Archive, Check, MoreHorizontal, Pencil, X } from "lucide-react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import { Input } from "@ai-chat/ui/components/ui/input";
import {
  SidebarMenuAction,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@ai-chat/ui/components/ui/sidebar";
import { usePointerOpenedMenu } from "@ai-chat/ui/hooks/use-pointer-opened-menu";
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
  archiveAcknowledged,
  rememberArchiveAcknowledged,
  subMenuActionClass,
} from "../chat/chat-thread-item";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import { useHistory } from "@/components/providers/history/history-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { projectDraftRoute } from "@/lib/draft-route";

export function HistoryThreadItem({ history, active }: {
  history: ForeignHistorySummary;
  active: boolean;
}) {
  const { renameSession, setSessionArchived } = useHistory();
  const { projects } = useProjects();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Radix 菜单关闭时会抢回焦点，进入编辑态需阻止其打断输入框 autoFocus
  const enteringEdit = useRef(false);
  const menu = usePointerOpenedMenu();

  /* 来源只说一遍。行首 logo 已经把「这是 Codex 的会话」说完，行尾再挂一枚
     文字标签就是同一句话的第二种说法——而两种说法必然有一种是多余的。
     同为一条会话，不该因为来路不同而换一套视觉语法：动作面（重命名/归档）
     也与 chat 行同构，只是全部落在产品侧 overlay，CLI 源文件永远只读。 */
  const backend = historyBackend(history.sourceKind);

  const startEdit = () => {
    enteringEdit.current = true;
    setDraft(history.title);
    setEditing(true);
  };

  const handleConfirm = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = draft.trim();
    if (!title || busy) return;
    if (title === history.title) return setEditing(false);
    setBusy(true);
    try {
      await renameSession(history.opaqueId, title);
      setEditing(false);
    } catch {
      // 失败保留编辑态供重试，warning 由 provider 呈现
    } finally {
      setBusy(false);
    }
  };

  const handleArchive = async () => {
    setBusy(true);
    try {
      await setSessionArchived(history.opaqueId, true);
      rememberArchiveAcknowledged();
      /* 与 chat 行同律：归档的是这条会话而不是它所在的 Project，
         把用户留在原 Project 的空白页上。 */
      if (active) navigate(projectDraftRoute(history.projectId, projects));
    } catch {
      // 失败文案由 HistoryProvider 投影为 warning，此处只收敛状态
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  const requestArchive = () => {
    if (busy) return;
    if (archiveAcknowledged()) void handleArchive();
    else setConfirmOpen(true);
  };

  // ─── 编辑态：整行换成输入框，导航与菜单彻底退场（与 chat 行同构）───
  if (editing) {
    return (
      <SidebarMenuSubItem className="w-full">
        <form
          className="flex items-center gap-1 px-1 py-0.5"
          onSubmit={handleConfirm}
        >
          <Input
            autoFocus
            value={draft}
            maxLength={200}
            aria-label="会话标题"
            className="h-7 flex-1 text-sm"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="取消"
            onClick={() => setEditing(false)}
          >
            <X />
          </Button>
          <Button
            type="submit"
            variant="ghost"
            size="icon-sm"
            aria-label="确认"
            disabled={busy || draft.trim().length === 0}
          >
            <Check />
          </Button>
        </form>
      </SidebarMenuSubItem>
    );
  }

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
            {...menu.triggerProps}
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
          onCloseAutoFocus={(event) => {
            if (enteringEdit.current) {
              enteringEdit.current = false;
              event.preventDefault();
              return;
            }
            menu.onCloseAutoFocus(event);
          }}
        >
          <DropdownMenuItem
            className="cursor-pointer whitespace-nowrap"
            onSelect={startEdit}
          >
            <Pencil />
            重命名
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            className="cursor-pointer whitespace-nowrap"
            onSelect={requestArchive}
          >
            <Archive />
            归档
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmationDialog
        open={confirmOpen}
        title="Archive chat?"
        description="The imported chat will leave the sidebar. You can restore it from Settings › Archive."
        confirmLabel="Archive"
        confirmTone="default"
        busy={busy}
        onOpenChange={setConfirmOpen}
        onConfirm={() => void handleArchive()}
      />
    </SidebarMenuSubItem>
  );
}
