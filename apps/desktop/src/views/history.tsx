"use client";

/**
 * [INPUT]: Depends on the router, I18n, HistoryProvider/client, PageShell, AgentBackendIcon for agent-backends, share ForeignHistoryTranscriptRows, and useChatSession + ChatComposer + assembleFirstTurnPayload for the product itself
 * [OUTPUT]: Provides HistoryRoute: Page headers, transcripts and input boxes are all from the same source as the product chat: the same ChatComposer is installed with the same first round, the back end is locked at the source, the model/permission/image attachment/Plan is actually used to continue the first round of the chat), only read the transcripts, split the page, uncontested reason disclosure and explicitly "continue this conversation" input
 * [POS]: The following pages link to the history of the views: The video is from ChatTranscript, and the input box is directly copied from ChatComposer and simply changed to "where to after sending"Not creating Product Chat or exposing Chat management action before adoption
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import {
  historyBackend,
  type ForeignHistoryBlock,
  type ForeignHistorySummary,
} from "../../shared/history-import-ipc";
import { useHistory } from "@/components/providers/history/history-provider";
import { adoptHistory, historyTranscript } from "@/lib/history/client";
import { PageShell } from "@/components/page-shell";
import { AgentBackendIcon } from "@/lib/agent-backends";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { errorMessage } from "@/lib/errors";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@ai-chat/ui/components/ai-elements/conversation";
import { ForeignHistoryTranscriptRows } from "@/components/chat/transcript/foreign-history-transcript";
import { ChatComposer } from "@/components/chat/composer/chat-composer";
import { useChatSession } from "@/components/chat/runtime/use-chat-session";
import { assembleFirstTurnPayload } from "@/components/chat/runtime/session/create-session-submit";
import type { PromptInputMessage } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { foreignHistoryAnchor } from "../../shared/foreign-history-grouping";
import {
  findTranscriptTarget,
  highlightTranscriptTarget,
} from "@/components/chat/transcript/transcript-highlight";

export function HistoryRoute() {
  const { t } = useAppTranslation();
  const { id = "" } = useParams();
  const { snapshot, loading } = useHistory();
  const summary = snapshot.entries.find((entry) => entry.opaqueId === id);

  if (loading) return <PageShell title={t("history.loading")}><div /></PageShell>;
  if (!summary) return <Navigate to="/" replace />;
  /* revision 换代即整体重挂：旧转录、旧 cursor 与在途请求随旧实例一起作废，
     无需代际计数器对账。 */
  return <HistoryTranscript key={`${summary.opaqueId}:${summary.historyRevision}`} summary={summary} />;
}

function HistoryTranscript({ summary }: { summary: ForeignHistorySummary }) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [blocks, setBlocks] = useState<ForeignHistoryBlock[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const backend = historyBackend(summary.sourceKind);

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

  useEffect(() => {
    let stale = false;
    void historyTranscript(summary.opaqueId)
      .then((page) => {
        if (stale) return;
        setBlocks(page.blocks);
        setCursor(page.nextCursor);
      })
      .catch((cause) => { if (!stale) setError(errorMessage(cause)); })
      .finally(() => { if (!stale) setBusy(false); });
    return () => { stale = true; };
  }, [summary.opaqueId]);

  const loadMore = useCallback(async () => {
    if (!cursor || busy) return;
    setBusy(true);
    try {
      const page = await historyTranscript(summary.opaqueId, cursor);
      setBlocks((current) => [...current, ...page.blocks]);
      setCursor(page.nextCursor);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }, [busy, cursor, summary.opaqueId]);

  /* 深链是一次性指令：命中即消费。不设消费位的话，之后每次 loadMore 都会
     把视口拽回同一目标再闪一次高亮。 */
  const consumedTargetRef = useRef("");
  useEffect(() => {
    const target = searchParams.get("b");
    if (!target || busy || consumedTargetRef.current === target) return;
    const split = target.indexOf(":");
    if (split < 0 || target.slice(0, split) !== summary.historyRevision) return;
    const node = findTranscriptTarget(foreignHistoryAnchor(target.slice(split + 1)));
    if (node) {
      consumedTargetRef.current = target;
      node.scrollIntoView({ block: "center", behavior: "smooth" });
      highlightTranscriptTarget(node);
      return;
    }
    if (cursor) queueMicrotask(() => { void loadMore(); });
  }, [blocks, busy, cursor, loadMore, searchParams, summary.historyRevision]);

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
      if (!submission.displayText) return;
      /* 失败原样抛回 PromptInput：它会保住草稿并把病因交给 composer 自己的
         准入提示——那正是产品 chat 里「这条发不出去」的落点。这里再写一份
         页面级错误，就成了同一件事说两遍。页面级 error 只留给转录加载。 */
      const receipt = await adoptHistory({
        opaqueId: summary.opaqueId,
        expectedHistoryRevision: summary.historyRevision,
        submission,
        turnOptions,
      });
      void navigate(`/chat/${receipt.chatId}`, { replace: true });
    },
    [
      navigate,
      planMode,
      selectedBackend,
      summary.historyRevision,
      summary.opaqueId,
      turnOptions,
    ]
  );

  /* ── 只关掉这条路上确实到不了的两样 ──────────────────────────
   * 图片附件与 Plan 现在都随 adopt 契约过桥，故加号菜单原样保留。留下的
   * 两个空位是 `$` 技能与 `@` section：它们投影成 skill/section 两种非文本
   * 项，而 skill 要 backend 的技能目录、section 要一条产品 Chat 的链——
   * 收养发生之前两者都还不存在，不是契约窄，是所指之物尚未诞生。
   * `persisted` 说的是「这条会话的身份已经定了」——外源会话确实如此：
   * 它在 Agent 那边早已存在，Project 与后端都不由这个输入框决定。composer
   * 认这一位来收起 Project 选择条并锁死 Agent 选择器，语义正好对上。
   * ────────────────────────────────────────────────────────── */
  const composer = useMemo(
    () => ({
      ...session.composer,
      persisted: true,
      inputDisabled: session.composer.inputDisabled || !summary.canResume,
      skills: [],
      sections: [],
      handleSubmit: adopt,
      handleQueueOrSubmit: adopt,
    }),
    [adopt, session.composer, summary.canResume]
  );

  /* 页头与产品 chat 同构：行首 Agent logo + 标题。不给返回键——产品 chat 页
     也没有，而这一页同样是从侧栏一行点进来的，「返回」只会把人送去一张与此处
     毫无关系的空白页。 */
  return (
    <PageShell
      title={summary.title}
      icon={<AgentBackendIcon backend={historyBackend(summary.sourceKind)} className="size-4" />}
    >
      <div className="flex h-full min-h-0 flex-col">
        <Conversation className="min-h-0 min-w-0 flex-1" initial="instant" resize="instant" role="log">
          <ConversationContent className="mx-auto w-full min-w-0 max-w-3xl gap-6">
            {summary.incompleteTail && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">{t("history.incompleteTail")}</p>}
            <ForeignHistoryTranscriptRows blocks={blocks} />
            {cursor && <Button className="w-full" variant="outline" disabled={busy} onClick={() => void loadMore()}>{t("history.loadMore")}</Button>}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        {/* 内容列的几何归 ChatComposer 自己（`mx-auto max-w-3xl p-4 pt-0`），
            这里只负责把错误对齐到同一列——再包一层 max-w-3xl 会双重收窄。 */}
        <div className="shrink-0 pt-4">
          {!summary.canResume && (
            <p className="mx-auto w-full max-w-3xl px-4 pb-2 text-muted-foreground text-sm">
              {t("history.resumeUnavailable")}
            </p>
          )}
          <ChatComposer controller={composer} enableSidePanel={false} />
          {error && (
            <p
              className="mx-auto w-full max-w-3xl px-4 pb-4 text-destructive text-sm"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </PageShell>
  );
}
