/**
 * [INPUT]: Depends on shared ChatSummary, renderer locale/catalog runtime, and ChatActivity from chat-activity-store; callers provide chat/activity snapshots and a frozen clock
 * [OUTPUT]: Provides ActivityGroup, groupChatsByActivity and compareRecent is the only quality updatedAt reverses); The active mode is exclusive Priority, the rest is grouped by the last five local calendar days, the first letters of the date title are written by the current locale
 * [POS]: The Activity of the renderer lib is the purest model boundary; Isolation time zone/DST, exclusive and sequential rules, not dependent on React/Provider/DOM
 */

import type { ChatSummary } from "../../shared/chats-ipc";
import type { ChatActivity } from "./chat-activity-store";
import { effectiveLocale, intlLocale } from "./i18n-locale";
import { translate } from "../../shared/i18n/runtime";
import { appearsInActivity } from "../../shared/placement/activity";

export type ActivityDayIndex = 0 | 1 | 2 | 3 | 4;

export type ActivityGroup = {
  id: string;
  label: string;
  chats: ChatSummary[];
};

const DAY_MS = 86_400_000;

const localDayOrdinal = (timestamp: number) => {
  const date = new Date(timestamp);
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS
  );
};

/* 「最近」的唯一口径。命令面板的 Recent 组也读这一个——各写各的比较器,
   两处对同一批会话给出两种顺序,是迟早的事。 */
export const compareRecent = (left: ChatSummary, right: ChatSummary) =>
  right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);

/* ── Priority 的判据塌成一次真值判断 ──────────────────────────────
 * chat-activity-store 里存在条目，就等于「有你还没消费掉的动静」：
 * 卡在你身上、跑挂了、跑完没看、正在跑——四者都是。进会话消费终态、
 * 缺省即无标记，那条不变量已经把「哪些会话该被顶上来」算完了；
 * 这里再枚举一遍状态子集，是给同一个问题养第二个真相源，
 * 于是屏幕上两个会话转着圈、Priority 却说「Nothing needs attention」。
 *
 * 组内按行动号召强度排：waiting 卡在你身上最急，failed 要你决策，
 * done 要你去看，running 是唯一「你什么都不用做」的，垫底。
 * 一条会话从开跑到你读完全程留在 Priority，中途只换图标不换组。
 * ────────────────────────────────────────────────────────── */
const PRIORITY_RANK: Record<ChatActivity, number> = {
  waiting: 0,
  failed: 1,
  done: 2,
  running: 3,
};

const labelDay = (now: number, dayIndex: ActivityDayIndex) => {
  if (dayIndex < 2) {
    const locale = intlLocale();
    const label = new Intl.RelativeTimeFormat(locale, {
      numeric: "auto",
    }).format(-dayIndex, "day");
    return label.replace(/^\p{L}/u, (first) => first.toLocaleUpperCase(locale));
  }
  const date = new Date(now);
  date.setDate(date.getDate() - dayIndex);
  return new Intl.DateTimeFormat(intlLocale(), { weekday: "long" }).format(date);
};

export function groupChatsByActivity({
  chats,
  activity,
  now,
  dayWindow = 5,
}: {
  chats: ChatSummary[];
  activity: ReadonlyMap<string, ChatActivity>;
  now: number;
  dayWindow?: number;
}): ActivityGroup[] {
  const priority: { chat: ChatSummary; rank: number }[] = [];
  const days = new Map<ActivityDayIndex, ChatSummary[]>();
  const window = Math.min(5, Math.max(0, Math.floor(dayWindow)));
  const today = localDayOrdinal(now);

  for (const chat of chats) {
    if (!appearsInActivity(chat)) continue;
    const state = activity.get(chat.id);
    if (state) {
      priority.push({ chat, rank: PRIORITY_RANK[state] });
      continue;
    }
    const dayIndex = Math.max(0, today - localDayOrdinal(chat.updatedAt));
    if (dayIndex >= window) continue;
    const key = dayIndex as ActivityDayIndex;
    const group = days.get(key) ?? [];
    group.push(chat);
    days.set(key, group);
  }

  priority.sort(
    (left, right) =>
      left.rank - right.rank || compareRecent(left.chat, right.chat)
  );

  const groups: ActivityGroup[] = [
    {
      id: "priority",
      label: translate(effectiveLocale(), "chat.sidebar.priority"),
      chats: priority.map(({ chat }) => chat),
    },
  ];
  for (let index = 0; index < window; index += 1) {
    const dayIndex = index as ActivityDayIndex;
    const dayChats = days.get(dayIndex);
    if (!dayChats?.length) continue;
    groups.push({
      id: `day-${dayIndex}`,
      label: labelDay(now, dayIndex),
      chats: dayChats.sort(compareRecent),
    });
  }
  return groups;
}
