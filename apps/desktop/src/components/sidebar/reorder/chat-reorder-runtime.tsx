/**
 * [INPUT]: Depends on @dnd-kit/core (DndContext, PointerSensor, collision helpers, per-row drag/drop hooks), drop-resolution, context, row-props, the merged sidebar rows, ChatsProvider.setChatSortKey, AppsProvider identities, SidebarRowMark, AgentBackendIcon and i18n.
 * [OUTPUT]: Provides ChatReorderRuntime: one DndContext per Chat container with insertion-edge tracking, a pointer-following drag pill (a plain fixed portal, not DragOverlay), a post-drag click guard and localized announcements, publishing ChatReorderContext for rows.
 * [POS]: The lazily loaded owner of drag state in components/sidebar (entered only through chat-reorder-list); cross-container drops are impossible because droppables are scoped per context.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { ChatSummary } from "../../../../shared/chats-ipc";
import type { ChatNavigationRow } from "../cloud/order";
import { SidebarRowMark } from "@ai-chat/ui/components/workspace/row";
import { finalOrder, planDrop, resolveDropSlot, type DropSlot, type ReorderRow } from "./drop-resolution";
import { ChatReorderContext, chatRowId, useChatReorder } from "./context";
import { PlainChatNavigationRow, type ChatNavigationRowProps } from "./chat-navigation-row";
import type { ChatRowReorderProps, DropEdge } from "./row-props";
import { useChats } from "@/components/providers/chats-provider";
import { useApps } from "@/components/providers/apps-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { AgentBackendIcon } from "@/lib/agent-backends";

type DropTarget = { overId: string; edge: DropEdge; slot: DropSlot };

/* ── 活动判定与落点：只认可见的东西 ────────────────────────────────
 * 8px 才起拖：行是链接，一次手抖的点击仍然必须导航。
 * 碰撞盒是源行自己的矩形随指针位移（dnd-kit 无 DragOverlay 时的默认）：先问「它还压在
 * 列表上吗」，压着才取最近的行；离开列表 over 归空，松手即取消——「不能跨 Project」于是
 * 不靠任何判断，而是每个容器各有自己的 DndContext。落点边缘按这个位移后的行中心与被压行
 * 中心比：与用户眼中「那一行被拎起来了」的心智一致。
 * 不用 dnd-kit 的 DragOverlay：@dnd-kit/core 是单模块，惰性 chunk 引用它的导出会把整段
 * 覆盖层代码抬进首屏 bundle；药丸只是一枚跟着指针走的 fixed 传送门，自己画更便宜。
 * ────────────────────────────────────────────────────────── */
const ACTIVATION_DISTANCE = 8;
const collision: CollisionDetection = (args) => rectIntersection(args).length ? closestCenter(args) : [];
/* 药丸挂在指针上而不是保留抓取偏移：抓住长标题的尾部时，保留偏移会让药丸整个
   跑到指针左侧很远，像是被甩掉了；固定偏移则永远像是被拎着。 */
const PILL_OFFSET = { x: 12, y: 16 };
type Point = { x: number; y: number };
const pointOf = (event: Event | null): Point | null => {
  if (!event || !("clientX" in event)) return null;
  const { clientX, clientY } = event as unknown as { clientX: number; clientY: number };
  return { x: clientX, y: clientY };
};

const preventDefault = (event: Event) => event.preventDefault();
const GUARD_WINDOW_MS = 50;

type TrackedEvent = Pick<DragMoveEvent, "active" | "over">;
function edgeOf(event: TrackedEvent): DropEdge | null {
  const rect = event.active.rect.current.translated, over = event.over;
  if (!rect || !over) return null;
  return rect.top + rect.height / 2 < over.rect.top + over.rect.height / 2 ? "before" : "after";
}

function ChatDragPreview({ chat, at }: { chat: ChatSummary; at: Point }) {
  const { t } = useAppTranslation();
  const { records: apps } = useApps();
  const context = chat.context;
  const app = context?.kind === "app-use" ? apps.find((candidate) => candidate.id === context.appId) : undefined;
  return (
    <div
      data-chat-drag-preview
      className="pointer-events-none fixed top-0 left-0 z-[999] inline-flex h-8 max-w-60 items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar px-2 text-sidebar-foreground text-xs shadow-md [-webkit-app-region:no-drag]"
      style={{ transform: `translate3d(${at.x - PILL_OFFSET.x}px, ${at.y - PILL_OFFSET.y}px, 0)` }}
    >
      <SidebarRowMark>
        {app
          ? <span className="text-sm leading-none">{app.manifest?.icon ?? "📦"}</span>
          : <AgentBackendIcon backend={chat.agent} tone="brand" className="text-sidebar-foreground/55" />}
      </SidebarRowMark>
      <span className="truncate">{chat.title ?? t("common.chats")}</span>
    </div>
  );
}

export function ChatReorderRuntime({
  rows,
  appProject = false,
  children,
}: {
  /** The container's complete sorted list, hidden pages included: neighbours beyond the page still bound a drop. */
  rows: ChatNavigationRow[];
  appProject?: boolean;
  children: ReactNode;
}) {
  const { t } = useAppTranslation();
  const { setChatSortKey } = useChats();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: ACTIVATION_DISTANCE } }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const targetRef = useRef<DropTarget | null>(null);
  /* dnd-kit calls the onDragEnd prop before the announcement monitor, so the outcome is parked here for the announcer. */
  const lastDropRef = useRef<DropTarget | null>(null);
  const reorderRows = useMemo<ReorderRow[]>(
    () => rows.map((row) => ({ id: chatRowId(row), draggable: row.kind === "native", order: row.order })),
    [rows]
  );
  const titleOf = useCallback((id: string) => {
    const row = rows.find((candidate) => chatRowId(candidate) === id);
    return (row?.kind === "native" ? row.chat.title : row?.head.chat.title) ?? t("common.chats");
  }, [rows, t]);
  const activeChat = activeId ? rows.find((row) => row.kind === "native" && row.chat.id === activeId) : undefined;

  /* dnd-kit 只 stopPropagation 拖后那次 click：React Router 的 onClick 不再跑，但 <a href="#/chat/…">
     的原生跳转照常发生——小幅拖动后原地松手，就会打开被拖的 chat。文档捕获阶段 preventDefault 一并堵上，
     50ms 后撤除，与 dnd-kit 自己撤 listener 的节奏相同。 */
  const guardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeId) return;
    /* Pin the owner document and cancel a still-pending removal: a drag that starts inside the previous
       drag's 50ms window must not lose its guard to that earlier timer. */
    const owner = document;
    if (guardTimer.current) clearTimeout(guardTimer.current);
    guardTimer.current = null;
    owner.addEventListener("click", preventDefault, { capture: true });
    owner.body.style.cursor = "grabbing";
    return () => {
      owner.body.style.cursor = "";
      guardTimer.current = setTimeout(() => {
        guardTimer.current = null;
        owner.removeEventListener("click", preventDefault, { capture: true });
      }, GUARD_WINDOW_MS);
    };
  }, [activeId]);

  const updateTarget = (next: DropTarget | null) => {
    targetRef.current = next;
    setTarget((current) => current?.overId === next?.overId && current?.edge === next?.edge ? current : next);
  };
  const onDragStart = (event: DragStartEvent) => {
    updateTarget(null);
    setPointer(pointOf(event.activatorEvent));
    setActiveId(String(event.active.id));
  };
  useEffect(() => {
    if (!activeId) return;
    const follow = (event: PointerEvent) => setPointer({ x: event.clientX, y: event.clientY });
    document.addEventListener("pointermove", follow);
    return () => document.removeEventListener("pointermove", follow);
  }, [activeId]);
  /* dnd-kit hands onDragMove the `over` of the previous commit and onDragOver the fresh one a beat later,
     so both feed the same tracker; the last word always belongs to the freshest rect + over pair. */
  const track = (event: TrackedEvent) => {
    const edge = edgeOf(event), over = event.over;
    if (!edge || !over) return updateTarget(null);
    const slot = resolveDropSlot(reorderRows, String(event.active.id), String(over.id), edge, { appProject });
    updateTarget(slot ? { overId: String(over.id), edge, slot } : null);
  };
  const finish = () => {
    setActiveId(null);
    updateTarget(null);
  };
  const onDragCancel = () => {
    lastDropRef.current = null;
    finish();
  };
  const onDragEnd = (event: DragEndEvent) => {
    const dropped = event.over ? targetRef.current : null;
    lastDropRef.current = dropped;
    finish();
    if (!dropped) return;
    const writes = planDrop(reorderRows, String(event.active.id), dropped.slot, { appProject });
    void (async () => {
      for (const write of writes) await setChatSortKey({ chatId: write.chatId, sortKey: write.sortKey });
    })().catch(() => {
      // ChatsProvider already restored the optimistic order and showed the toast.
    });
  };

  const announcements = useMemo(() => ({
    onDragStart: ({ active }: { active: { id: string | number } }) => t("chat.sidebar.reorder.pickedUp", { title: titleOf(String(active.id)) }),
    onDragOver: () => undefined,
    onDragEnd: ({ active }: { active: { id: string | number } }) => {
      const title = titleOf(String(active.id)), dropped = lastDropRef.current;
      if (!dropped) return t("chat.sidebar.reorder.unchanged", { title });
      const order = finalOrder(reorderRows, String(active.id), dropped.slot);
      return t("chat.sidebar.reorder.moved", { title, position: order.findIndex((row) => row.id === String(active.id)) + 1, count: order.length });
    },
    onDragCancel: () => t("chat.sidebar.reorder.cancelled"),
  }), [reorderRows, t, titleOf]);

  const state = useMemo(
    () => ({ Row: BoundChatNavigationRow, activeId, overId: target?.overId ?? null, edge: target?.edge ?? null }),
    [activeId, target]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      accessibility={{ announcements, screenReaderInstructions: { draggable: "" } }}
      onDragStart={onDragStart}
      onDragMove={track}
      onDragOver={track}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <ChatReorderContext.Provider value={state}>{children}</ChatReorderContext.Provider>
      {/* 传送到 body：Project 子列表的 <ul> 带 translate-x-0，会把 position:fixed 的药丸扣在自己里面。 */}
      {activeChat?.kind === "native" && pointer
        ? createPortal(<ChatDragPreview chat={activeChat.chat} at={pointer} />, document.body)
        : null}
    </DndContext>
  );
}

function BoundChatNavigationRow(props: ChatNavigationRowProps) {
  const { row } = props;
  const id = chatRowId(row), draggable = row.kind === "native";
  const reorder = useChatReorder();
  /* Same node for both roles (queue precedent): the row is the slot it can also leave. */
  const { setNodeRef: setDraggableRef, setActivatorNodeRef, listeners } = useDraggable({ id, disabled: !draggable || !reorder });
  const { setNodeRef: setDroppableRef } = useDroppable({ id, disabled: !reorder });
  /* Stable identity: React detaches (null) and reattaches a callback ref whose identity changed, and every row
     re-renders on each edge change during a drag, so a fresh closure here would re-register both dnd-kit nodes per frame. */
  const itemRef = useCallback((element: HTMLLIElement | null) => {
    setDraggableRef(element);
    setDroppableRef(element);
  }, [setDraggableRef, setDroppableRef]);
  const state: ChatRowReorderProps | undefined = reorder
    ? {
        itemRef,
        hostRef: draggable ? setActivatorNodeRef : undefined,
        listeners: draggable ? listeners : undefined,
        dragging: reorder.activeId === id,
        dropEdge: reorder.overId === id ? reorder.edge : null,
        suppressed: reorder.activeId !== null,
      }
    : undefined;
  return <PlainChatNavigationRow {...props} reorder={state} />;
}
