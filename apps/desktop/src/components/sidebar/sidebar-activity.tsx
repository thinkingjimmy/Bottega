"use client";

/**
 * [INPUT]: Depends on Chats Provider, chat-activity-store, global snapshot, activity-groups, pure model, ChatThreadItem, Sidebar-active-path useSidebarActivePath, shared Sidebar grouping title token, React and sidebar originals
 * [OUTPUT]: Provides SidebarActivity; Rename the Permanent Priority to the last five local date groups and give the chat.preview to the row units that are shortened to two rows of previews
 * [POS]: The Sidebar Activity list compiler for components, only installed in Activity mode; Zero-point timers are responsible for day-to-day rearrangement
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@ai-chat/ui/components/ui/sidebar";
import { ChatThreadItem } from "./chat/chat-thread-item";
import { useSidebarActivePath } from "./sidebar-active-path";
import { SIDEBAR_GROUP_LABEL_CLASS_NAME } from "./sidebar-collapsible-group";
import { useChats } from "../providers/chats-provider";
import { groupChatsByActivity } from "@/lib/activity-groups";
import {
  readAllChatActivity,
  subscribeAllChatActivity,
} from "@/lib/chat-activity-store";

const nextLocalMidnight = (now: number) => {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
};

/* ── 第二行说什么 ──────────────────────────────────────────────
 * 曾经说的是 Project 名。可 Activity 一屏里那句话常常四行全一样——
 * 同屏方差趋零的事实，占着最贵的一整行。现在整行只说最后一条发言的
 * 提炼：逐行不同，且正好是「这场对话进行到哪了」——标题诞生时就定死，
 * 永远说不出这件事。Project 连字形也不再露面：它属于 Library 的
 * 「东西住在哪」，不属于 Activity 的「此刻在发生什么」。
 * 于是本编排器连 Projects Provider 都不必再订阅。
 * ────────────────────────────────────────────────────────── */
export function SidebarActivity() {
  const activePath = useSidebarActivePath();
  const { chats } = useChats();
  const activity = useSyncExternalStore(
    subscribeAllChatActivity,
    readAllChatActivity,
    readAllChatActivity
  );
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const delay = Math.max(1, nextLocalMidnight(now) - Date.now());
    const timeout = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timeout);
  }, [now]);

  const groups = useMemo(
    () =>
      groupChatsByActivity({
        chats: chats.filter((chat) => !chat.effectiveArchived),
        activity,
        now,
      }),
    [activity, chats, now]
  );

  return groups.map((group) => (
    <SidebarGroup key={group.id} className="px-0.5 py-0.25">
      <SidebarGroupLabel className={SIDEBAR_GROUP_LABEL_CLASS_NAME}>
        {group.label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        {group.id === "priority" && group.chats.length === 0 ? (
          /* 空的 Priority 是好消息，不是缺失：用与预览同一档的弱对比说完
             就退场，音量高于此就成了「这里本该有东西」的错觉。 */
          <p className="px-2 py-1 text-[11px] text-sidebar-foreground/60">
            Nothing needs attention
          </p>
        ) : (
          <SidebarMenu>
            {group.chats.map((chat) => (
              <ChatThreadItem
                key={chat.id}
                chat={chat}
                active={activePath === `/chat/${chat.id}`}
                preview={chat.preview ?? undefined}
              />
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  ));
}
