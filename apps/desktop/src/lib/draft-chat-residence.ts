/**
 * [INPUT]: Depends on React, react-router navigation, chat-composer-store draft slot, and draft-route residence policy
 * [OUTPUT]: Provides useDraftChatResidence: the receipt-independent post-send page switch plus draft-slot retirement
 * [POS]: The sole actuator of draft-residence policy in lib, consumed by the ChatRoute; policy stays pure in draft-route while the slot stays owned by chat-composer-store
 */

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import type { ChatSummary } from "../../shared/chats-ipc";
import { commitDraftChat, useDraftChatId } from "./chat-composer-store";
import { chatRoute, draftResidence } from "./draft-route";

/* ── 空白页驻留观察：发送后切页的唯一通道 ──────────────────────────
   换槽与切页共用一个不变量：路由叫得出名字、或列表里已经有这条记录——
   它就不再是草稿。裁决归 draftResidence 一处：受理回执不参与——回执与
   upserted 事件谁先到 renderer 无从约定，而事件先到会换槽重挂 ChatView、
   视图 fence 随之如实作废迟到回执，挂在回执上的导航就此蒸发（「发送后
   不切页」的成因）。「记录已存在」不受时序影响，竞态在结构上不成立。
   blankDraftRef 是驻留证据：本槽曾以白纸呈现给正站在这页的用户。任何
   离开（id 落地）都作废它——中途走开再回来的弃稿到达时退役换新，白纸
   如约；驻留中落盘的才是「刚发出去的那条」，带用户过去，退役由落地后
   的 id 分支完成。 */
export function useDraftChatResidence({
  id,
  chats,
  chatsLoading,
}: {
  id: string | undefined;
  chats: readonly Pick<ChatSummary, "id">[];
  chatsLoading: boolean;
}) {
  const draftChatId = useDraftChatId();
  const navigate = useNavigate();
  const blankDraftRef = useRef<string | null>(null);
  useEffect(() => {
    if (id) {
      blankDraftRef.current = null;
      commitDraftChat(id);
      return;
    }
    const residence = draftResidence({
      draftChatId,
      chats,
      chatsLoading,
      blankSeen: blankDraftRef.current === draftChatId,
    });
    if (residence === "blank") blankDraftRef.current = draftChatId;
    else if (residence === "navigate") navigate(chatRoute(draftChatId));
    else if (residence === "retire") commitDraftChat(draftChatId);
  }, [chats, chatsLoading, draftChatId, id, navigate]);
}
