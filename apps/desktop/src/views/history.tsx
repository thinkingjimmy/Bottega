"use client";

/**
 * [INPUT]: Depends on router, i18n, HistoryProvider/client, PageShell, panel-slot store, useChatSession, ChatViewFrame, and first-turn payload assembly
 * [OUTPUT]: Provides HistoryRoute with the shared chat frame, independently abortable paged/full-index immutable prefix, adopt-only composer, explicit panel eligibility, identity-transfer hold, and post-adoption panel continuity
 * [POS]: The foreign-session route adapter in views; it changes persistence/navigation semantics while reusing the complete product chat surface
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import {
  historyBackend,
  type ForeignHistoryBlock,
  type ForeignHistorySummary,
} from "../../shared/history-import-ipc";
import { useHistory } from "@/components/providers/history/history-provider";
import {
  adoptHistory,
  historyTranscript,
  historyTranscriptIndex,
} from "@/lib/history/client";
import { PageShell, panelChromeClassName } from "@/components/page-shell";
import { AgentBackendIcon } from "@/lib/agent-backends";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { errorMessage } from "@/lib/errors";
import { ChatViewFrame } from "@/components/chat/chat-view";
import { useChatSession } from "@/components/chat/runtime/use-chat-session";
import { assembleFirstTurnPayload } from "@/components/chat/runtime/session/create-session-submit";
import type { PromptInputMessage } from "@ai-chat/ui/components/ai-elements/prompt-input";
import {
  foreignHistoryAnchor,
  groupForeignHistoryBlocks,
} from "../../shared/foreign-history-grouping";
import {
  consumeSidePanelRequest,
  nextSidePanelCommandNonce,
  type PanelSessionContext,
  type SidePanelRequest,
} from "@/components/chat/runtime/chat-session-model";
import { panelSlotStore } from "@/components/chat/side-panel/panel-slot-store";
import { PanelRightIcon } from "lucide-react";
import type { HistoryPrefixProjection } from "@/lib/history-prefix";

const isAbortError = (cause: unknown) =>
  cause instanceof Error && cause.name === "AbortError";

export function HistoryRoute() {
  const { t } = useAppTranslation();
  const { id = "" } = useParams();
  const { snapshot, loading } = useHistory();
  const [pendingSummary, setPendingSummary] =
    useState<ForeignHistorySummary | null>(null);
  const current = snapshot.entries.find((entry) => entry.opaqueId === id);
  const summary = current ?? pendingSummary;

  if (loading) return <PageShell title={t("history.loading")}><div /></PageShell>;
  if (!summary) return <Navigate to="/" replace />;
  /* revision 换代即整体重挂：旧转录、旧 cursor 与在途请求随旧实例一起作废，
     无需代际计数器对账。 */
  return (
    <HistoryTranscript
      key={`${summary.opaqueId}:${summary.historyRevision}`}
      onAdoptionPendingChange={(pending) =>
        setPendingSummary(pending ? summary : null)
      }
      summary={summary}
    />
  );
}

function HistoryTranscript({
  onAdoptionPendingChange,
  summary,
}: {
  onAdoptionPendingChange: (pending: boolean) => void;
  summary: ForeignHistorySummary;
}) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const [blocks, setBlocks] = useState<ForeignHistoryBlock[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [sidePanelRequest, setSidePanelRequest] =
    useState<SidePanelRequest | null>(null);
  const loadGenerationRef = useRef(0);
  const blocksRef = useRef<ForeignHistoryBlock[]>([]);
  const cursorRef = useRef<string | null>(null);
  const initialFlightRef = useRef<AbortController | null>(null);
  const pageFlightRef = useRef<{
    cursor: string;
    generation: number;
    controller: AbortController;
    promise: Promise<boolean>;
  } | null>(null);
  const backend = historyBackend(summary.sourceKind);
  const panelContext = useMemo<PanelSessionContext>(() => ({
    kind: "foreign",
    foreignRef: {
      opaqueId: summary.opaqueId,
      historyRevision: summary.historyRevision,
    },
  }), [summary.historyRevision, summary.opaqueId]);

  /* ── 输入框就是产品那一个 ──────────────────────────────────────
   * 会话以 opaqueId 为 scope 起一个正常的 chat session：这不是为了拼出一个
   * 长得像 composer 的东西，而是因为 model/permission/thinking 的落点本就
   * 与 adopt 读的是同一把钥匙——`useChatSettings` 写 `{conversationId: opaqueId}`，
   * adopt 从前也正是从这把钥匙上解析 turnOptions。以前这些选项没有 UI，只能
   * 从设置里静默继承；现在它们回到用户手里，而落点一个字都没变。
   * ────────────────────────────────────────────────────────── */
  const session = useChatSession({
    scope: { conversationId: summary.opaqueId },
    project: { kind: "selectable" },
    draftAgent: backend,
    panelContext,
  });
  const { lockBackend, selectProject } = session.composer;

  /* 后端与 Project 都不是这次输入能决定的：续聊必须回到原 Agent（main 侧
     `turnOptions.backend !== entry.sourceKind` 直接拒收），落点 Project 也早
     由导入时定死。锁一次即可——lockBackend 顺带把该后端的 turnOptions 解析
     进本 scope，与产品 chat 认领已有会话时走的是同一条路。 */
  useEffect(() => {
    void lockBackend(backend);
    selectProject(summary.projectId);
  }, [backend, lockBackend, selectProject, summary.projectId]);

  const loadInitial = useCallback(() => {
    const generation = ++loadGenerationRef.current;
    initialFlightRef.current?.abort();
    pageFlightRef.current?.controller.abort();
    const controller = new AbortController();
    initialFlightRef.current = controller;
    blocksRef.current = [];
    cursorRef.current = null;
    pageFlightRef.current = null;
    setBlocks([]);
    setCursor(null);
    setBusy(true);
    setError("");
    void historyTranscript(summary.opaqueId, undefined, controller.signal)
      .then((page) => {
        if (generation !== loadGenerationRef.current) return;
        if (page.revision !== summary.historyRevision) {
          throw new Error("HISTORY_REVISION_CHANGED");
        }
        blocksRef.current = page.blocks;
        cursorRef.current = page.nextCursor;
        setBlocks(page.blocks);
        setCursor(page.nextCursor);
      })
      .catch((cause) => {
        if (!isAbortError(cause) && generation === loadGenerationRef.current) {
          setError(errorMessage(cause));
        }
      })
      .finally(() => {
        if (initialFlightRef.current === controller) {
          initialFlightRef.current = null;
        }
        if (generation === loadGenerationRef.current) setBusy(false);
      });
  }, [summary.historyRevision, summary.opaqueId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) loadInitial();
    });
    return () => {
      active = false;
      loadGenerationRef.current += 1;
      initialFlightRef.current?.abort();
      pageFlightRef.current?.controller.abort();
    };
  }, [loadInitial, reloadToken]);

  const retryInitialLoad = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  /* loadMore 与深链共用同一条 cursor 单飞；正文页永远只按当前 cursor 追加一次。
     Find 的全量索引走另一份只读投影，不再有资格改写这里的 blocks/cursor。 */
  const loadNextPage = useCallback((): Promise<boolean> => {
    const nextCursor = cursorRef.current;
    if (!nextCursor) return Promise.resolve(false);
    const generation = loadGenerationRef.current;
    const existing = pageFlightRef.current;
    if (existing?.cursor === nextCursor && existing.generation === generation) {
      return existing.promise;
    }
    setBusy(true);
    setError("");
    const controller = new AbortController();
    const request = historyTranscript(summary.opaqueId, nextCursor, controller.signal)
      .then((page) => {
        if (generation !== loadGenerationRef.current) return false;
        if (page.revision !== summary.historyRevision) {
          throw new Error("HISTORY_REVISION_CHANGED");
        }
        if (cursorRef.current !== nextCursor) return false;
        const seen = new Set(
          blocksRef.current.map(
            (block) => `${block.kind}:${block.id}:${block.deliverySeq}`
          )
        );
        const additions = page.blocks.filter(
          (block) => !seen.has(`${block.kind}:${block.id}:${block.deliverySeq}`)
        );
        blocksRef.current = [...blocksRef.current, ...additions];
        cursorRef.current = page.nextCursor;
        setBlocks(blocksRef.current);
        setCursor(page.nextCursor);
        return additions.length > 0 || page.nextCursor !== nextCursor;
      })
      .catch((cause) => {
        if (!isAbortError(cause) && generation === loadGenerationRef.current) {
          setError(errorMessage(cause));
        }
        throw cause;
      })
      .finally(() => {
        if (pageFlightRef.current?.controller === controller) {
          pageFlightRef.current = null;
        }
        if (generation === loadGenerationRef.current) setBusy(false);
      });
    pageFlightRef.current = {
      cursor: nextCursor,
      generation,
      controller,
      promise: request,
    };
    return request;
  }, [summary.historyRevision, summary.opaqueId]);

  const loadMore = useCallback(() => {
    void loadNextPage().catch(() => undefined);
  }, [loadNextPage]);

  const materializeHistoryTarget = useCallback(async (anchorId: string) => {
    const hasTarget = () => groupForeignHistoryBlocks(blocksRef.current).some(
      (row) =>
        foreignHistoryAnchor(summary.historyRevision, row.key) === anchorId
    );
    while (!hasTarget() && cursorRef.current) {
      const advanced = await loadNextPage();
      if (!advanced) break;
    }
  }, [loadNextPage, summary.historyRevision]);

  /* 整条复用里唯一被改写的一句：按下发送之后去哪。产品 chat 在这里创建
     Chat 并发起 turn，外源会话则走 durable adopt——它自己会创建 Chat、导入
     前传、发起首轮，再把我们送到那条产品 Chat 上。 */
  const { turnOptions, selectedBackend, planMode } = session.composer;
  const adopt = useCallback(
    async (message: PromptInputMessage) => {
      const submission = assembleFirstTurnPayload({
        message,
        chatId: summary.opaqueId,
        backend: turnOptions.backend,
        selectedBackend,
        planMode,
      });
      if (!submission.displayText && !submission.attachmentPayloads?.length) return;
      /* 失败原样抛回 PromptInput：它会保住草稿并把病因交给 composer 自己的
         准入提示——那正是产品 chat 里「这条发不出去」的落点。这里再写一份
         页面级错误，就成了同一件事说两遍。页面级 error 只留给转录加载。 */
      onAdoptionPendingChange(true);
      const receipt = await adoptHistory({
          opaqueId: summary.opaqueId,
          expectedHistoryRevision: summary.historyRevision,
          submission,
          turnOptions,
        }).catch((cause) => {
          onAdoptionPendingChange(false);
          throw cause;
        });
      const active = panelSlotStore.getFor(panelContext).active;
      const target = active === "browser" ? "browser" : "openShell";
      panelSlotStore.migrate(panelContext, {
        kind: "adopted",
        productRef: {
          chatId: receipt.chatId,
          incarnationId: receipt.incarnationId,
        },
      });
      void navigate(`/chat/${receipt.chatId}`, {
        replace: true,
        state: { openSidePanel: target },
      });
    },
    [
      navigate,
      planMode,
      selectedBackend,
      summary.historyRevision,
      summary.opaqueId,
      turnOptions,
      panelContext,
      onAdoptionPendingChange,
    ]
  );

  /* ── 覆写只改「提交去哪」，能力面与产品 composer 一字不差 ──────────
   * 附件、Plan、`$` 技能与 `@` section 全部随 adopt 契约过桥（skills 目录按
   * 锁定 backend + Project 解析，section 指向别的产品 Chat——收养前皆已存在），
   * 于是这里不再清空任何清单。真正的差异只有三件：handleSubmit/handleQueueOrSubmit
   * 改道 durable adopt；canResume=false 时禁用输入并披露；`persisted` 置真——
   * 它说的是「这条会话的身份已经定了」：外源会话在 Agent 那边早已存在，
   * Project 与后端都不由这个输入框决定，composer 认这一位来收起 Project
   * 选择条并锁死 Agent 选择器，语义正好对上。
   * ────────────────────────────────────────────────────────── */
  const composer = useMemo(
    () => ({
      ...session.composer,
      persisted: true,
      inputDisabled: session.composer.inputDisabled || !summary.canResume,
      handleSubmit: adopt,
      handleQueueOrSubmit: adopt,
    }),
    [adopt, session.composer, summary.canResume]
  );

  const controller = useMemo(
    () => ({ ...session, composer }),
    [composer, session]
  );
  const historyPrefix = useMemo<HistoryPrefixProjection>(
    () => ({
      ...makeHistoryPrefixBase(summary, blocks, cursor),
      loadState: busy
        ? { kind: "loading" }
        : error
          ? { kind: "error", message: error, retry: retryInitialLoad }
          : { kind: "ready" },
    }),
    [blocks, busy, cursor, error, retryInitialLoad, summary]
  );
  const loadFullIndex = useCallback(async (signal: AbortSignal) => {
    const index = await historyTranscriptIndex(
      summary.opaqueId,
      summary.historyRevision,
      signal
    );
    if (index.revision !== summary.historyRevision) {
      throw new Error("HISTORY_REVISION_CHANGED");
    }
    return {
      ...makeHistoryPrefixBase(summary, index.blocks, null),
      loadState: { kind: "ready" } as const,
    };
  }, [summary]);

  /* 页头与产品 chat 同构：行首 Agent logo + 标题。不给返回键——产品 chat 页
     也没有，而这一页同样是从侧栏一行点进来的，「返回」只会把人送去一张与此处
     毫无关系的空白页。 */
  return (
    <PageShell
      title={summary.title}
      icon={<AgentBackendIcon backend={historyBackend(summary.sourceKind)} className="size-4" />}
      actions={
        <Button
          aria-label={t("chat.openSidePanel")}
          className={panelChromeClassName}
          onClick={() => setSidePanelRequest({
            conversationKey: summary.opaqueId,
            command: {
              target: "openShell",
              nonce: nextSidePanelCommandNonce(),
            },
          })}
          size="icon-lg"
          type="button"
          variant="ghost"
        >
          <PanelRightIcon />
        </Button>
      }
    >
      <ChatViewFrame
        controller={controller}
        enableSidePanel
        historyPrefix={historyPrefix}
        historyIndexLoader={loadFullIndex}
        onHistoryJumpMiss={materializeHistoryTarget}
        historyPrefixFooter={
          <>
            {historyPrefix.quality.incompleteTail === true && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                {t("history.incompleteTail")}
              </p>
            )}
            {historyPrefix.nextCursor && (
              <Button className="w-full" variant="outline" disabled={busy} onClick={loadMore}>
                {t("history.loadMore")}
              </Button>
            )}
            {!historyPrefix.capabilities.canResume && (
              <p className="text-muted-foreground text-sm">{t("history.resumeUnavailable")}</p>
            )}
            {historyPrefix.loadState.kind === "error" && (
              <div className="flex items-center justify-between gap-3" role="alert">
                <p className="text-destructive text-sm">{historyPrefix.loadState.message}</p>
                <Button onClick={historyPrefix.loadState.retry} size="sm" variant="outline">
                  {t("common.retry")}
                </Button>
              </div>
            )}
          </>
        }
        sidePanelRequest={sidePanelRequest}
        onConsumeSidePanelRequest={(nonce) =>
          setSidePanelRequest((current) => consumeSidePanelRequest(current, nonce))
        }
      />
    </PageShell>
  );
}

function makeHistoryPrefixBase(
  summary: ForeignHistorySummary,
  blocks: ForeignHistoryBlock[],
  cursor: string | null
): Omit<HistoryPrefixProjection, "loadState"> {
  return {
    source: {
      kind: "foreign",
      contentGenerationKey: summary.historyRevision,
      routeGenerationKey: summary.historyRevision,
    },
    title: summary.title,
    blocks,
    nextCursor: cursor,
    quality: {
      incompleteTail: summary.incompleteTail,
      sourceStatus: "match",
    },
    capabilities: { canResume: summary.canResume },
  };
}
