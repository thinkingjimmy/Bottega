"use client";

/**
 * [INPUT]: Depends on React, router, I18n, shadcn Command/Kbd/Spinner, shared AgentBackendIcon, lib/search client, shared search hit and search-text, Chats/Projects Provider, chat-activity-store, activity-groups compareRecent and lib/shortcuts
 * [OUTPUT]: Provides CommandPalette; recent and searched Chat rows carry their Agent identity, empty-query rows are prevalidated executable destinations, query hits stream from main, and Quick actions retain reactive shortcut keycaps and locator routing
 * [POS]: The only command panel owner in the sidebar/search; 3 types of intent (near/hit/action) projected into the same PaletteRow, keyboard navigation handed over to cmdk
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { Database, Settings, SquarePen } from "lucide-react";
import type { GlobalSearchHit, SearchJobStarted } from "../../../../shared/search-ipc";
import { normalizedSearchMatch, tokenizeSearchQuery } from "../../../../shared/search-text";
import { cancelGlobalSearch, pullGlobalSearch, startGlobalSearch } from "@/lib/search/client";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@ai-chat/ui/components/ui/command";
import { Kbd } from "@ai-chat/ui/components/ui/kbd";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useChats } from "@/components/providers/chats-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { readAllChatActivity, subscribeAllChatActivity } from "@/lib/chat-activity-store";
import { compareRecent } from "@/lib/activity-groups";
import { useShortcutKeys, type ShortcutId } from "@/lib/shortcuts";
import { errorMessage } from "@/lib/errors";
import { AgentBackendIcon } from "@/lib/agent-backends";
import { openProductDestination, productDestinationRoute } from "@/lib/product-navigation";
import { searchDestination } from "../../../../shared/placement/search";

/* 七条是「一屏看得完」与「够得着昨天」的交点；再多就得滚，滚起来的
   最近列表和搜索没有区别，那这一组就白设了。 */
const RECENT_LIMIT = 7;

/* ── 一个行模型，三个投影 ──────────────────────────────────────────
 * 面板同时承载三类意图：跳到最近的会话、执行一个动作、打开一条搜索命中。
 * 三者的数据形状天差地别（ChatSummary / 本地常量 / GlobalSearchHit），
 * 但屏幕上它们是同一种东西——一行，能选中，回车就走。
 * 把差异吃在投影函数里，渲染层就只剩一份代码，没有一个 if 在问
 * 「这行到底是哪一类」。能消失的分支永远比能写对的分支更优雅。
 * ────────────────────────────────────────────────────────────── */
type PaletteRow = {
  key: string;
  icon: ReactNode;
  title: string;
  /** 行尾限定词：项目名 / agent / owner。与 shortcut 二选一。 */
  meta?: string;
  snippet?: string;
  shortcut?: ShortcutId;
  run(): void;
};

export function CommandPalette({
  open,
  onOpenChange,
  onNewChat,
  onOpenSettings,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onNewChat(): void;
  onOpenSettings(): void;
}) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const { chats } = useChats();
  const { projects } = useProjects();
  const activity = useSyncExternalStore(
    subscribeAllChatActivity,
    readAllChatActivity,
    readAllChatActivity
  );
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GlobalSearchHit[]>([]);
  const [job, setJob] = useState<SearchJobStarted | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const jobRef = useRef<SearchJobStarted | null>(null);

  const pull = async (active: SearchJobStarted, nextCursor: string, append: boolean, expectedEpoch: number) => {
    const page = await pullGlobalSearch({ jobId: active.jobId, cursor: nextCursor, credit: 20, byteBudget: 128 * 1024 });
    if (epoch.current !== expectedEpoch || jobRef.current?.jobId !== active.jobId) return;
    setHits((current) => append ? [...current, ...page.hits] : page.hits);
    setCursor(page.nextCursor);
  };

  useEffect(() => {
    const current = ++epoch.current;
    const previous = jobRef.current;
    jobRef.current = null;
    if (previous) void cancelGlobalSearch(previous.jobId);
    const value = query.trim();
    queueMicrotask(() => {
      if (current !== epoch.current) return;
      setJob(null);
      setError("");
      if (!open || !value) {
        setHits([]);
        setCursor(null);
        setBusy(false);
      }
    });
    if (!open || !value) return;
    const timer = window.setTimeout(() => {
      setBusy(true);
      void startGlobalSearch(value).then(async (started) => {
        if (current !== epoch.current) { await cancelGlobalSearch(started.jobId); return; }
        jobRef.current = started;
        setJob(started);
        await pull(started, started.cursor, false, current);
      }).catch((cause) => current === epoch.current && setError(errorMessage(cause))).finally(() => {
        if (current === epoch.current) setBusy(false);
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  useEffect(() => () => {
    epoch.current += 1;
    if (jobRef.current) void cancelGlobalSearch(jobRef.current.jobId);
  }, []);

  /* 关掉即归零：⌘K 承诺的是「落地即最近会话」，留着上次的查询会让同一个
     手势有两种落点——上次搜过什么决定这次看到什么。
     归零写在渲染期而不是 effect 里：它不是与外部系统同步，而是「prop 变
     了就跟着调状态」。放进 effect 就得先提交一帧带着旧查询的界面，再级联
     一次重渲染；写在这里 React 当场重跑本次渲染，屏幕上从来只有一种状态。 */
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setQuery("");
  }

  /* ── 投影 1：最近会话 ───────────────────────────────────────── */
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  );
  const recents = useMemo(
    () => chats
      .filter((chat) => !chat.effectiveArchived)
      .flatMap((chat) => {
        const destination = searchDestination(chat);
        return destination ? [{ chat, destination }] : [];
      })
      .sort((left, right) => compareRecent(left.chat, right.chat))
      .slice(0, RECENT_LIMIT),
    [chats]
  );
  const recentRows: PaletteRow[] = recents.map(({ chat, destination }) => ({
    key: `chat:${chat.id}`,
    icon: activity.get(chat.id) === "running"
      ? <Spinner className="text-muted-foreground" data-chat-activity="running" />
      : (
          <AgentBackendIcon
            backend={chat.agent}
            className="size-3.5"
            data-agent-backend={chat.agent}
          />
        ),
    title: chat.title ?? t("history.searchUntitled"),
    meta: chat.projectId ? projectNames.get(chat.projectId) : undefined,
    run: () => {
      onOpenChange(false);
      void openProductDestination(destination, navigate);
    },
  }));

  /* ── 投影 2：服务端命中 ─────────────────────────────────────── */
  const hitRows: PaletteRow[] = hits.map((hit) => ({
    key: hit.key,
    icon: hit.source === "chat"
      ? (
          <AgentBackendIcon
            backend={hit.agent}
            className="size-3.5"
            data-agent-backend={hit.agent}
          />
        )
      : <Database />,
    title: hit.title,
    meta: hit.subtitle,
    snippet: hit.snippet,
    run: () => {
      onOpenChange(false);
      void openProductDestination(
        hit.destination,
        (route, options) => navigate(locatorRoute(hit, route), options)
      );
    },
  }));

  /* ── 投影 3：Quick actions ──────────────────────────────────── */
  const actionRows: PaletteRow[] = [
    { key: "action:new-chat", icon: <SquarePen />, title: t("common.newChat"), shortcut: "newChat", run: onNewChat },
    { key: "action:settings", icon: <Settings />, title: t("common.settings"), shortcut: "settings", run: onOpenSettings },
  ];
  /* 本地过滤走 shared/search-text，与主进程同一套归一化与 AND 匹配——
     换成 String.includes 会在 CJK 与全角输入上和服务端给出两种答案。 */
  const matchedActions = filterByQuery(actionRows, query);

  const searching = Boolean(query.trim());
  const chatRows = searching ? hitRows : recentRows;
  const nothing = !busy && searching && !chatRows.length && !matchedActions.length && !error;

  /* ── 选中项锚在首行，而不是交给 cmdk 自便 ────────────────────────
   * cmdk 只在挂载与 search 变化时选第一项，之后会守住当前选中项。而这个
   * 列表的首行是会换人的：会话从 Provider 异步到达、命中从主进程流式到达。
   * 首行换了而选中项没动，回车就落在上一批的某一行上——最坏情况是空态
   * 刚打开、会话还没到，选中项停在 Quick actions 的「New chat」，
   * ⌘K 然后回车于是新建了一个会话。
   * 判据取「首行 key 变了没有」：换了就重锚，没换就不动。于是分页 append
   * 不打断选择，方向键也不被拽回去——两者都不改首行。 */
  const first = (chatRows[0] ?? matchedActions[0])?.key;
  const [anchor, setAnchor] = useState<string>();
  const [selected, setSelected] = useState<string>();
  if (first && first !== anchor) {
    setAnchor(first);
    setSelected(first);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("history.search")}
      description={t("history.searchPlaceholder")}
      className="sm:max-w-2xl"
    >
      {/* shouldFilter=false：结果由主进程流式给出，cmdk 再按 value 过滤一遍
          会把服务端刚送到的命中当场筛掉。键盘导航与选中态仍归 cmdk。 */}
      <Command shouldFilter={false} loop value={selected} onValueChange={setSelected}>
        <CommandInput
          autoFocus
          placeholder={t("history.searchPlaceholder")}
          value={query}
          onValueChange={setQuery}
        />
        {/* 原语默认 max-h-72 是给 Popover 内联下拉的密度，装不下最近七条 +
            两条动作，Quick actions 会整组落在折叠线以下。只覆盖本处。 */}
        <CommandList className="max-h-[420px]">
          {nothing && <CommandEmpty>{t("history.searchEmpty")}</CommandEmpty>}
          {chatRows.length > 0 && (
            <CommandGroup heading={searching ? t("history.searchResults") : t("history.searchRecent")}>
              {chatRows.map((row) => <Row key={row.key} row={row} />)}
            </CommandGroup>
          )}
          {chatRows.length > 0 && matchedActions.length > 0 && <CommandSeparator />}
          {matchedActions.length > 0 && (
            <CommandGroup heading={t("history.searchActions")}>
              {matchedActions.map((row) => <Row key={row.key} row={row} />)}
            </CommandGroup>
          )}
          {error && <p className="p-4 text-destructive text-xs" role="alert">{error}</p>}
          {cursor && job && (
            <div className="p-1">
              <Button className="w-full" variant="ghost" size="sm" disabled={busy} onClick={() => {
                const expectedEpoch = epoch.current;
                const active = job;
                setBusy(true);
                void pull(active, cursor, true, expectedEpoch)
                  .catch((cause) => {
                    if (expectedEpoch === epoch.current && jobRef.current?.jobId === active.jobId) setError(errorMessage(cause));
                  })
                  .finally(() => {
                    if (expectedEpoch === epoch.current && jobRef.current?.jobId === active.jobId) setBusy(false);
                  });
              }}>{t("history.searchMore")}</Button>
            </div>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

/* 行尾那一格永远是 CommandShortcut：原语正是靠 data-slot=command-shortcut
   的存在来收起自带的勾选图标，缺了它每一行右侧都会多出一个 14px 的幽灵槽。
   槽里装什么随行而变，槽本身不变。 */
function Row({ row }: { row: PaletteRow }) {
  return (
    <CommandItem value={row.key} onSelect={row.run} className={row.snippet ? "items-start" : undefined}>
      <span className={row.snippet ? "mt-[3px] flex" : "flex"}>{row.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate" data-palette-title="">{row.title}</span>
        {row.snippet && (
          <span className="mt-0.5 line-clamp-2 block text-[0.6875rem] text-muted-foreground">{row.snippet}</span>
        )}
      </span>
      {/* 空槽也要渲染：原语的勾选图标靠 group-has-data-[slot=command-shortcut]
          收起，槽缺席时它就以 ml-auto 占住行尾 14px。根级 chat 没有项目名，
          正是那个「有时多一格、有时不多」的来路。 */}
      <CommandShortcut className={row.shortcut ? "flex items-center gap-1 tracking-normal" : "tracking-normal"}>
        {row.shortcut ? <ShortcutHint id={row.shortcut} /> : row.meta}
      </CommandShortcut>
    </CommandItem>
  );
}

/* 键帽走响应式绑定：改绑立刻换字，停用则整组消失——槽位仍在
   （见上：勾选图标的收起靠 data-slot=command-shortcut 的存在）。
   hooks 规则也是它成为子组件的原因：row.shortcut 是可选的。 */
function ShortcutHint({ id }: { id: ShortcutId }) {
  const keys = useShortcutKeys(id);
  return keys ? <>{keys.map((glyph) => <Kbd key={glyph}>{glyph}</Kbd>)}</> : null;
}

function filterByQuery(rows: PaletteRow[], query: string) {
  const value = query.trim();
  if (!value) return rows;
  let tokens: readonly string[];
  try {
    tokens = tokenizeSearchQuery(value);
  } catch {
    /* 空查询与 16 token 上限之外的输入没有本地可匹配的动作 */
    return [];
  }
  return rows.filter((row) => normalizedSearchMatch(row.title, tokens) !== null);
}

function locatorRoute(hit: GlobalSearchHit, route = productDestinationRoute(hit.destination)) {
  return hit.target
    ? `${route}${route.includes("?") ? "&" : "?"}m=${encodeURIComponent(hit.target.messageId)}`
    : route;
}
