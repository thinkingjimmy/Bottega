"use client";

/**
 * [INPUT]: Depends on Sidebar/dropdown/skeleton/spinner primitives, shared row geometry/action tone, rename/archive feedback, Chats/Projects/Apps/Setup providers, archive restore client, typed product navigation, i18n, chat activity, and routing
 * [OUTPUT]: Provides ChatThreadItem with App-leading identity, typed App Use/exact Editor opening, title/preview/activity, rename, and direct archive actions with targeted View/Undo recovery
 * [POS]: The shared chat line unit of components/sidebar/chat, consumed by the Chats, Activity and Project sublists, unifies the two levels of hover/focus feedback and does not embed li
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Archive,
  CircleQuestionMark,
  MoreHorizontal,
  Pencil,
  TriangleAlert,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@ai-chat/ui/components/ui/sidebar";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import {
  SidebarRowMark,
  SidebarRowTag,
  SidebarRowTitle,
  sidebarRootMenuActionClass,
  sidebarSubRowClass,
} from "../sidebar-row";
import {
  SidebarRenameDialog,
  useSidebarRenameMenu,
} from "../rename/sidebar-rename-dialog";
import { useSidebarArchiveFeedback } from "../archive/archive-feedback";
import type { ChatSummary } from "../../../../shared/chats-ipc";
import { useChats } from "@/components/providers/chats-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { useApps } from "@/components/providers/apps-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import { projectDraftRoute } from "@/lib/draft-route";
import { restoreArchiveTargets } from "@/lib/archive-client";
import {
  useChatActivity,
  type ChatActivity,
} from "@/lib/chat-activity-store";
import { openProductDestination, productDestinationRoute } from "@/lib/product-navigation";
import { openAppEditor } from "@/lib/apps-client";

type ChatThreadItemProps = {
  chat: ChatSummary;
  active: boolean;
  variant?: "root" | "sub";
  badge?: string;
  /** 最后一条发言的提炼；给了就长出零缩进的两行预览（Activity 独有）。 */
  preview?: string;
};

/* ── 行「正在被交涉」的判定 ────────────────────────────────────────
 * 用 :has(:focus-visible) 而非 focus-within：鼠标点过行内链接或按钮后 focus 就留在那儿，
 * focus-within 会让整行连同 hover 浮层永久钉住（指针早已移出侧栏）——
 * 那说明的是「点过」而非「正在看」。sidebar-row.css 的 marquee 已按此判定书写，
 * 两处必须同构，否则会出现「标题滑着、底色却是灭的」这种自相矛盾的行。
 * ────────────────────────────────────────────────────────── */

const rootMenuButtonClass =
  "font-normal! group-has-data-[sidebar=menu-action]/menu-item:pr-2 group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground group-has-[:focus-visible]/menu-item:bg-sidebar-accent group-has-[:focus-visible]/menu-item:text-sidebar-accent-foreground";

const menuActionToneClass =
  "cursor-pointer text-sidebar-foreground/35 hover:bg-transparent hover:text-sidebar-foreground focus-visible:text-sidebar-foreground aria-expanded:text-sidebar-foreground";

/** history 行与 chat 行共用同一 hover 显隐法则；导出以免两处各抄一份漂移。 */
export const subMenuActionClass =
  `pointer-events-none opacity-0 ${menuActionToneClass} group-has-[:focus-visible]/menu-sub-item:pointer-events-auto group-has-[:focus-visible]/menu-sub-item:opacity-100 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 aria-expanded:pointer-events-auto aria-expanded:opacity-100`;

/* ── 行首那一格只说一件事：这个会话此刻要你知道什么 ────────────────
 * 四种活动态各自占满行首等宽槽，缺省才落回 Agent logo——
 * 「谁家的 agent」是静态归属，任何活动态都比它更急于被看见。
 * waiting 与 running 的分野是行动号召：转圈只需等待，问号在点名。
 * ────────────────────────────────────────────────────────── */
function ActivityDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center justify-center">
      <span aria-hidden className={`size-2 rounded-full ${className}`} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function ChatThreadIcon({
  chat,
  unavailable,
  detecting,
  activity,
  appIdentity,
}: {
  chat: ChatSummary;
  unavailable: boolean;
  detecting: boolean;
  activity?: ChatActivity;
  appIdentity?: { icon: string; name: string };
}) {
  const { t } = useAppTranslation();
  if (activity === "waiting") {
    return (
      <CircleQuestionMark
        className="text-violet-500"
        aria-label={t("chat.sidebar.waiting")}
      />
    );
  }
  if (activity === "running") {
    return (
      <Spinner
        className="text-sidebar-foreground/55"
        aria-label={t("chat.sidebar.running")}
        data-chat-activity="running"
      />
    );
  }
  if (activity === "done") {
    return (
      <ActivityDot className="bg-blue-500" label={t("chat.sidebar.done")} />
    );
  }
  if (activity === "failed") {
    return (
      <TriangleAlert
        className="text-amber-500"
        aria-label={t("chat.sidebar.failed")}
      />
    );
  }
  if (chat.context?.kind === "app-use" && appIdentity) {
    return (
      <span aria-label={appIdentity.name} className="text-sm leading-none">
        {appIdentity.icon}
      </span>
    );
  }
  const backend = backendLabel(chat.agent);
  return (
    <AgentBackendIcon
      backend={chat.agent}
      /* 不可用时红色剪影压过品牌身份：这一格图标承载的是健康，不是身份。 */
      tone={unavailable ? "mono" : "brand"}
      /* 只说颜色。尺寸是 SidebarRowMark 这一格的法则，不归痕迹所有 */
      className={
        unavailable ? "text-destructive/70" : "text-sidebar-foreground/55"
      }
      aria-label={
        detecting
          ? t("chat.sidebar.backendDetecting", { backend })
          : unavailable
          ? t("chat.sidebar.backendUnavailable", { backend })
          : t("chat.sidebar.backendAvailable", { backend })
      }
    />
  );
}

export function ChatThreadItem({
  chat,
  active,
  variant = "root",
  badge,
  preview,
}: ChatThreadItemProps) {
  const { t } = useAppTranslation();
  const { renameChat, archiveChat } = useChats();
  const { projects } = useProjects();
  const { records: apps } = useApps();
  const setup = useSetup();
  const navigate = useNavigate();
  const showArchiveFeedback = useSidebarArchiveFeedback();
  const activity = useChatActivity(chat.id);
  const context = chat.context;
  const [renameOpen, setRenameOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const renameMenu = useSidebarRenameMenu(() => setRenameOpen(true));
  const appUseContext = context?.kind === "app-use" ? context : null;
  const app = appUseContext
    ? apps.find((candidate) => candidate.id === appUseContext.appId)
    : undefined;
  const Item = variant === "sub" ? SidebarMenuSubItem : SidebarMenuItem;
  const MenuButton =
    variant === "sub" ? SidebarMenuSubButton : SidebarMenuButton;
  const backendStatus = setup.status?.backends.find(
    (backend) => backend.id === chat.agent
  )?.status;
  const backendUnavailable =
    backendStatus !== undefined && backendStatus !== "ready";
  const handleArchive = async () => {
    setBusy(true);
    try {
      await archiveChat(chat.id);
      if (active && context?.kind === "app-use") return;
      if (active && context?.kind === "app-edit") {
        const destination = await openAppEditor({
          appId: context.appId,
          requestId: crypto.randomUUID(),
          mode: "resume",
        });
        navigate(productDestinationRoute(destination));
        return;
      }
      /* 归档的是这条 chat 而不是它所在的 Project：把用户留在原 Project 的
         空白页上，下一句话仍在同一个上下文里说。路由守卫是同一判据的另一
         半，两处必须给出同一个落点，否则谁先落地就成了行为的定义者。 */
      if (active) navigate(projectDraftRoute(chat.projectId, projects));
      showArchiveFeedback({
        kind: "chat",
        id: chat.id,
        undo: () => restoreArchiveTargets([{ kind: "chat", id: chat.id }]),
      });
    } catch {
      // 失败文案由 ChatsProvider 弹 toast，此处只收敛状态
    } finally {
      setBusy(false);
    }
  };

  const requestArchive = () => {
    if (!busy) void handleArchive();
  };

  const titleNode =
    chat.title === null ? (
      <>
        <span className="sr-only">{t("chat.generatingTitle")}</span>
        <Skeleton className="h-4 w-28" />
      </>
    ) : (
      <SidebarRowTitle>{chat.title}</SidebarRowTitle>
    );

  const openChat = () => {
    if (!chat.incarnationId || context?.kind === "ordinary" || !context) return;
    const destination = context.kind === "app-use"
      ? {
          kind: "app-use-chat" as const,
          appId: context.appId,
          chatId: chat.id,
          incarnationId: chat.incarnationId,
        }
      : {
          kind: "app-editor-chat" as const,
          appId: context.appId,
          projectId: context.projectId,
          chatId: chat.id,
          incarnationId: chat.incarnationId,
        };
    void openProductDestination(
      destination,
      navigate
    );
  };

  // ─── 普通态：导航 + hover 更多菜单 + 删除二次确认 ───
  return (
    <Item className={variant === "sub" ? "w-full" : undefined}>
      {/* ── 两种壳子，一种骨架 ──────────────────────────────────
          有预览时链接转成竖列：标题行照旧（图标 + 标题 + 可选 tag），
          预览另起一行**顶格**——不跟着标题缩进那 24px。缩进本是为了让
          第二行看起来「属于」第一行，可这里的行首图标只有 14px，归属感
          早由整行的 hover 底色说完了；再让出 24px，买到的只是对齐的
          仪式感，卖掉的是每行两次的可读字数。
          浮层动作固定 `top-1.5`，天然停在标题那一行，于是第二行整块地
          完全归预览——不必再为「尾巴钻到按钮底下」写任何遮罩。 */}
      <MenuButton
        asChild
        className={`${
          variant === "sub" ? sidebarSubRowClass : rootMenuButtonClass
        }${preview ? " h-auto! min-h-8 flex-col items-stretch gap-0.5 py-1.5" : ""}`}
        isActive={active}
      >
        {context && context.kind !== "ordinary" && chat.incarnationId ? (
          <button type="button" onClick={openChat}>
          <span className="flex w-full min-w-0 items-center gap-2">
            <SidebarRowMark>
              <ChatThreadIcon
                chat={chat}
                unavailable={backendUnavailable}
                detecting={backendStatus === undefined}
                activity={activity}
                appIdentity={{
                  icon: app?.manifest?.icon ?? "📦",
                  name: app?.displayName ?? t("common.apps"),
                }}
              />
            </SidebarRowMark>
            {titleNode}
            {badge && <SidebarRowTag>{badge}</SidebarRowTag>}
          </span>
          {/* `whitespace-normal!` 是必需的：宿主基类写了
              `[&>span:last-child]:truncate`（特指度 0,1,1），它的 nowrap 会
              压过 line-clamp，把两行悄悄压回一行且连省略号都没有。 */}
          {preview ? (
            <span
              data-chat-preview
              className="line-clamp-2 whitespace-normal! text-[11px] text-sidebar-foreground/60 leading-snug"
            >
              {preview}
            </span>
          ) : null}
          </button>
        ) : (
          <Link to={`/chat/${chat.id}`}>
            <span className="flex w-full min-w-0 items-center gap-2">
              <SidebarRowMark>
                <ChatThreadIcon
                  chat={chat}
                  unavailable={backendUnavailable}
                  detecting={backendStatus === undefined}
                  activity={activity}
                />
              </SidebarRowMark>
              {titleNode}
              {badge && <SidebarRowTag>{badge}</SidebarRowTag>}
            </span>
            {preview ? (
              <span data-chat-preview className="line-clamp-2 whitespace-normal! text-[11px] text-sidebar-foreground/60 leading-snug">
                {preview}
              </span>
            ) : null}
          </Link>
        )}
      </MenuButton>

      <SidebarMenuAction
        showOnHover={variant === "root"}
        className={
          variant === "sub"
            ? subMenuActionClass
            : sidebarRootMenuActionClass
        }
        aria-label={t("chat.sidebar.archiveChat")}
        disabled={busy}
        onClick={requestArchive}
      >
        <Archive />
      </SidebarMenuAction>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            {...renameMenu.triggerProps}
            showOnHover={variant === "root"}
            className={`right-7 ${
              variant === "sub"
                ? subMenuActionClass
                : sidebarRootMenuActionClass
            }`}
            aria-label={t("chat.sidebar.moreActions")}
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
            {t("common.rename")}
          </DropdownMenuItem>
          {/* 归档可回收，故用常规色：红留给不可撤销的动作。 */}
          <DropdownMenuItem
            className="whitespace-nowrap"
            onSelect={requestArchive}
          >
            <Archive />
            {t("chat.sidebar.archive")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SidebarRenameDialog
        open={renameOpen}
        currentName={chat.title ?? ""}
        title={t("common.renameChatTitle")}
        description={t("common.renameChatDescription")}
        maxLength={200}
        onOpenChange={setRenameOpen}
        onRename={(title) => renameChat({ chatId: chat.id, title })}
        onCloseAutoFocus={renameMenu.onDialogCloseAutoFocus}
      />
    </Item>
  );
}
