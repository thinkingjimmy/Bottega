"use client";

/**
 * [INPUT]: Depends on shared Chat row actions/rename, Sidebar primitives, effective confetti preference, immediate archive feedback, data providers, archive restore client, product navigation, reorder row-props, and i18n
 * [OUTPUT]: Renders canonical Chat rows with a focus-preserving archive action, single-flight success, executor badges, post-archive recovery that yields to toast View, and the optional drag ghost / drop indicator; exports ChatDropIndicator and chatRowDropAttributes for sibling row kinds
 * [POS]: Shared chat row unit of components/sidebar/chat, consumed by the Chats, Activity, and Project sublists; unifies both hover/focus feedback levels, leaves list-item semantics to its caller and drag state to reorder/
 */

import { projectAvailability } from "../../../../shared/agent-availability/projection";
import { ChatExecutorBadge } from "../cloud/rows";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  CircleQuestionMark,
  TriangleAlert,
} from "lucide-react";
import { ChatRowActions } from "@ai-chat/ui/components/workspace/actions/chat";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@ai-chat/ui/components/ui/sidebar";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { cn } from "@ai-chat/ui/lib/utils";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import {
  SIDEBAR_ROOT_ROW_INSET,
  SIDEBAR_SUB_ROW_INSET,
  SidebarRowMark,
  SidebarRowTag,
  SidebarRowTitle,
  sidebarSubRowClass,
} from "@ai-chat/ui/components/workspace/row";
import {
  SidebarRenameDialog,
  useSidebarRenameMenu,
} from "../rename/sidebar-rename-dialog";
import { useSidebarArchiveFeedback } from "../archive/archive-feedback";
import { useArchiveConfettiPreference } from "../archive/archive-preference";
import { useSidebarActivePath } from "../active/active-path";
import type { ChatSummary } from "../../../../shared/chats-ipc";
import { useChats } from "@/components/providers/chats-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { useApps } from "@/components/providers/apps-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  AgentBackendIcon,
  backendLabel,
} from "@/lib/agent-backends";
import { projectDraftRoute } from "@/lib/draft-route";
import { restoreArchiveTargets } from "@/lib/archive-client";
import {
  useChatActivity,
  type ChatActivity,
} from "@/lib/chat-activity-store";
import { openProductDestination, productDestinationRoute } from "@/lib/product-navigation";
import { openAppEditor } from "@/lib/apps-client";
import type { ChatRowDropProps, ChatRowReorderProps, DropEdge } from "../reorder/row-props";

type ChatThreadItemProps = {
  chat: ChatSummary;
  variant?: "root" | "sub";
  badge?: string;
  /** 最后一条发言的提炼；给了就长出零缩进的两行预览（Activity 独有）。 */
  preview?: string;
  /** 在 ChatReorderList 里才有：拖动源/落点槽的节点引用与视觉态，由 reorder/ 计算。 */
  reorder?: ChatRowReorderProps;
};

/* ── 落点线与拖动幽灵：语义属性在行上，几何在这里，颜色只有一个 ──────
 * 线是 2px 的 sidebar-foreground（浅色下近黑、深色下近白），起点一枚 8px 空心圆——
 * 圆是「插入点」的读法，线是「插到这一整行的宽度」；容器 8px 高，居中压在相邻两行
 * 之间那 1px 的 gap 上（-top-1 / -bottom-1）。起点与本行内容起点对齐：Project 子行
 * 的线跟标题一样缩进，根级行贴 SidebarMenuButton 的内边距。用 data 属性而不是类名
 * 表达状态，是为了让 DOM 测试读语义而非当日的 Tailwind 皮肤；幽灵的样式写在
 * sidebar-row.css。拖动期间整列 pointer-events-none：hover 底色、标题滑动、行尾
 * 动作一并静默，不必逐条与它们的 hover 规则打特异度战争。
 * ────────────────────────────────────────────────────────── */
export function ChatDropIndicator({ edge, variant = "root" }: { edge: DropEdge | null; variant?: "root" | "sub" }) {
  if (!edge) return null;
  return (
    <span
      aria-hidden
      data-drop-indicator={edge}
      className={`pointer-events-none absolute right-2 z-10 flex h-2 items-center ${variant === "sub" ? SIDEBAR_SUB_ROW_INSET : SIDEBAR_ROOT_ROW_INSET} ${edge === "before" ? "-top-1" : "-bottom-1"}`}
    >
      <span className="size-2 shrink-0 rounded-full border-2 border-sidebar-foreground bg-sidebar" />
      <span className="h-0.5 min-w-0 flex-1 rounded-full bg-sidebar-foreground" />
    </span>
  );
}

export function chatRowDropAttributes(reorder: ChatRowDropProps | undefined, dragging = false) {
  if (!reorder) return {};
  return {
    "data-chat-dragging": dragging ? "" : undefined,
    "data-drop-edge": reorder.dropEdge ?? undefined,
    className: reorder.suppressed ? "pointer-events-none" : undefined,
  };
}

/* ── 行「正在被交涉」的判定 ────────────────────────────────────────
 * 用 :has(:focus-visible) 而非 focus-within：鼠标点过行内链接或按钮后 focus 就留在那儿，
 * focus-within 会让整行连同 hover 浮层永久钉住（指针早已移出侧栏）——
 * 那说明的是「点过」而非「正在看」。sidebar-row.css 的 marquee 已按此判定书写，
 * 两处必须同构，否则会出现「标题滑着、底色却是灭的」这种自相矛盾的行。
 * ────────────────────────────────────────────────────────── */

const rootMenuButtonClass =
  "font-normal! group-has-data-[sidebar=menu-action]/menu-item:pr-2 group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground group-has-[:focus-visible]/menu-item:bg-sidebar-accent group-has-[:focus-visible]/menu-item:text-sidebar-accent-foreground";

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
  availabilityState,
  activity,
  appIdentity,
}: {
  chat: ChatSummary;
  availabilityState: import("../../../../shared/agent-availability/types").AvailabilityState;
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
      tone="brand"
      className={availabilityState === "ready" ? "text-sidebar-foreground/55" : "text-muted-foreground"}
      aria-label={`${backend} · ${t(`agentAvailability.state.${availabilityState}`)}`}

    />
  );
}

export function ChatThreadItem({
  chat,
  variant = "root",
  badge,
  preview,
  reorder,
}: ChatThreadItemProps) {
  const { t } = useAppTranslation();
  const activePath = useSidebarActivePath();
  const { renameChat, archiveChat } = useChats();
  const { projects } = useProjects();
  const { records: apps } = useApps();
  const setup = useSetup();
  const navigate = useNavigate();
  const showArchiveFeedback = useSidebarArchiveFeedback();
  const { enabled: confettiEnabled } = useArchiveConfettiPreference();
  const archivePending = useRef(false);
  const activity = useChatActivity(chat.id);
  const context = chat.context;
  const [renameOpen, setRenameOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const renameMenu = useSidebarRenameMenu(() => setRenameOpen(true));
  const appUseContext = context?.kind === "app-use" ? context : null;
  /* App Use chats live on the App route, so their identity is the hash suffix;
     every other chat is active exactly on its own /chat route. */
  const active = appUseContext
    ? activePath.endsWith(`#app-use:${chat.id}`)
    : activePath === `/chat/${chat.id}`;
  const app = appUseContext
    ? apps.find((candidate) => candidate.id === appUseContext.appId)
    : undefined;
  const Item = variant === "sub" ? SidebarMenuSubItem : SidebarMenuItem;
  const MenuButton =
    variant === "sub" ? SidebarMenuSubButton : SidebarMenuButton;
  const backend = setup.status?.backends.find(
    (candidate) => candidate.id === chat.agent
  );
  const availabilityState = projectAvailability(backend, setup.now).state;
  const handleArchive = async () => {
    if (archivePending.current) return;
    archivePending.current = true;
    setBusy(true);
    try {
      await archiveChat(chat.id);
    } catch {
      // ChatsProvider owns archive failures; no success feedback is emitted.
      archivePending.current = false;
      setBusy(false);
      return;
    }
    let recoveryNavigationAllowed = true;
    showArchiveFeedback({
      kind: "chat",
      id: chat.id,
      undo: () => restoreArchiveTargets([{ kind: "chat", id: chat.id }]),
      onViewStart: () => { recoveryNavigationAllowed = false; },
    });
    try {
      if (active && context?.kind === "app-use") return;
      if (active && context?.kind === "app-edit") {
        const destination = await openAppEditor({
          appId: context.appId,
          requestId: crypto.randomUUID(),
          mode: "resume",
        });
        if (recoveryNavigationAllowed) navigate(productDestinationRoute(destination));
        return;
      }
      /* 归档的是这条 chat 而不是它所在的 Project：把用户留在原 Project 的
         空白页上，下一句话仍在同一个上下文里说。路由守卫是同一判据的另一
         半，两处必须给出同一个落点，否则谁先落地就成了行为的定义者。 */
      if (active) navigate(projectDraftRoute(chat.projectId, projects));
    } catch {
      // The archive already succeeded. Navigation recovery must not resubmit it.
    } finally {
      archivePending.current = false;
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

  const drop = chatRowDropAttributes(reorder, reorder?.dragging);
  const hostProps = { ref: reorder?.hostRef, ...reorder?.listeners };

  // ─── 普通态：导航 + hover 更多菜单 + 删除二次确认 ───
  return (
    <Item
      ref={reorder?.itemRef}
      {...drop}
      /* Present once the reorder runtime has bound this row: the observable "you can drag me now" for drivers and tests. */
      data-chat-draggable={reorder?.listeners ? "" : undefined}
      className={cn(variant === "sub" && "w-full", drop.className)}
    >
      <ChatDropIndicator edge={reorder?.dropEdge ?? null} variant={variant} />
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
          <button type="button" onClick={openChat} {...hostProps}>
          <span className="flex w-full min-w-0 items-center gap-2">
            <SidebarRowMark>
              <ChatThreadIcon
                chat={chat}
                availabilityState={availabilityState}
                activity={activity}
                appIdentity={{
                  icon: app?.manifest?.icon ?? "📦",
                  name: app?.displayName ?? t("common.apps"),
                }}
              />
            </SidebarRowMark>
            {titleNode}
            {badge && <SidebarRowTag>{badge}</SidebarRowTag>}
            <ChatExecutorBadge chatId={chat.id} />
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
          <Link to={`/chat/${chat.id}`} {...hostProps}>
            <span className="flex w-full min-w-0 items-center gap-2">
              <SidebarRowMark>
                <ChatThreadIcon
                  chat={chat}
                  availabilityState={availabilityState}
                  activity={activity}
                />
              </SidebarRowMark>
              {titleNode}
              {badge && <SidebarRowTag>{badge}</SidebarRowTag>}
              <ChatExecutorBadge chatId={chat.id} />
            </span>
            {preview ? (
              <span data-chat-preview className="line-clamp-2 whitespace-normal! text-[11px] text-sidebar-foreground/60 leading-snug">
                {preview}
              </span>
            ) : null}
          </Link>
        )}
      </MenuButton>

      <ChatRowActions
        nested={variant === "sub"}
        confetti={confettiEnabled}
        disabled={busy}
        renameMenu={renameMenu}
        onArchive={requestArchive}
        copy={{ more: t("chat.sidebar.moreActions"), rename: t("common.rename"), archive: t("chat.sidebar.archive"),
          archiveChat: t("chat.sidebar.archiveChat"), archiveHint: t("settings.general.archiveConfettiTooltip") }}
      />

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
