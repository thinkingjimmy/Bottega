"use client";

/**
 * [INPUT]: Depends on React, router, I18n, controlled query, shared SearchPalette/SearchRow, Command groups and Kbd/Spinner, shared AgentBackendIcon, lib/search client, shared search hit and search-text, Chats/Projects Provider, chat-activity-store, activity-groups compareRecent and lib/shortcuts
 * [OUTPUT]: Provides CommandSearchContent; recent and searched Chat rows carry their Agent identity, empty-query rows are prevalidated executable destinations, query hits stream from main, and Quick actions retain reactive shortcut keycaps and locator routing
 * [POS]: Lazy native result/query adapter in sidebar/search; recent/hit/action intents all project into the same PaletteRow, with keyboard navigation handed off to cmdk
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { Database, Settings, SquarePen } from "lucide-react";
import type { GlobalSearchHit, SearchJobStarted } from "../../../../shared/search-ipc";
import { normalizedSearchMatch, tokenizeSearchQuery } from "../../../../shared/search-text";
import { cancelGlobalSearch, pullGlobalSearch, startGlobalSearch } from "@/lib/search/client";
import {
  CommandEmpty,
  CommandGroup,
  CommandSeparator,
} from "@ai-chat/ui/components/ui/command";
import { SearchPalette } from "@ai-chat/ui/components/search/palette";
import { SearchRow } from "@ai-chat/ui/components/search/row";
import { Kbd } from "@ai-chat/ui/components/ui/kbd";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useChats } from "@/components/providers/chats-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { readAllChatActivity, subscribeAllChatActivity } from "@/lib/chat-activity-store";
import { compareRecent } from "@/lib/activity-groups";
import { useShortcutKeys, type ShortcutId } from "@/lib/shortcuts";
import { errorMessage } from "@ai-chat/ui/lib/errors";
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

export function CommandSearchContent({
  query,
  setQuery,
  autoFocus,
  open,
  onOpenChange,
  onNewChat,
  onOpenSettings,
}: {
  query: string;
  setQuery(value: string): void;
  autoFocus: boolean;
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

  const first = (chatRows[0] ?? matchedActions[0])?.key;

  return (
      <SearchPalette query={query} onQueryChange={setQuery} label={t("history.search")}
        placeholder={t("history.searchPlaceholder")} first={first} busy={busy} inputProps={{ autoFocus }}>
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
      </SearchPalette>
  );
}

function Row({ row }: { row: PaletteRow }) {
  return <SearchRow value={row.key} onSelect={row.run} title={row.title} icon={row.icon}
    snippet={row.snippet} trailing={row.shortcut ? <ShortcutHint id={row.shortcut} /> : row.meta} />;
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
