/**
 * [INPUT]: Depends on renderer Current Intl locale ((AssistantChatMessage is type-only, not dependent on running)
 * [OUTPUT]: Provides formatMessageTime (formatDuration) with workedForLabel (text of the timetable, null meaning headless)
 * [POS]: lib's chat shows a formatted pure function, which is run by a message action and consumed by ChatTurn, which is released from React and returns independently
 */

import type { AssistantChatMessage } from "../../shared/chats-ipc";
import { effectiveLocale, intlLocale } from "./i18n-locale";
import { translate } from "../../shared/i18n/runtime";

export const formatMessageTime = (createdAt: number) =>
  new Intl.DateTimeFormat(intlLocale(), {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(createdAt));

export function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const format = (value: number, unit: "minute" | "second") =>
    new Intl.NumberFormat(intlLocale(), {
      style: "unit",
      unit,
      unitDisplay: "narrow",
    }).format(value);
  return minutes > 0
    ? `${format(minutes, "minute")} ${format(seconds % 60, "second")}`
    : format(seconds, "second");
}

/* ── 计时头：说什么与说不说，本是同一个问题 ──────────────────────────
 * 两种"无工时可报"都归 null，视图便不必自己判断，只需渲染或不渲染：
 *   durationMs 缺席 · "新版流式 turn"的标记，旧消息本就没有这笔账；
 *   失败且无过程 · 一秒即死的 turn 没有工时。流式期它连 Working for 行都不
 *     曾有（无过程即无行），落定却凭空多出一条横线压在错误卡上——那是对
 *     "干了一秒活"的虚报。死前确有过程时头仍要留，那是那段过程的唯一入口。
 * ────────────────────────────────────────────────────────────── */
export function workedForLabel(message: AssistantChatMessage): string | null {
  if (message.durationMs === undefined) return null;
  if (message.isError && !message.parts?.length) return null;
  return translate(effectiveLocale(), "chat.workedFor", {
    duration: formatDuration(message.durationMs),
  });
}
