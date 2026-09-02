/**
 * [INPUT]: Depends on router, i18n, Chats/Projects/Setup providers, canonical chat context, the exact App Editor route gate, draft routing/residence, PageShell, side-panel capability policy, and ChatView
 * [OUTPUT]: Provides ChatRoute for ordinary/adopted/imported chats resolved through the canonical history routes, imported-segment facts and composer locks, main-approved App Editor chats, fixed Editor drafts, legacy App Use replacement, post-send navigation, Project guards, and context-safe side-panel commands while draft Project actions stay in Composer context
 * [POS]: The sole product chat route adapter in views
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ChatView, ChatViewFrame } from "@/components/chat/chat-view";
import type { ImportSegmentFacts } from "@/components/chat/transcript/chat-transcript";
import { SkillsOnboardingCard } from "@/components/chat/skills-onboarding-card";
import {
  consumeSidePanelRequest,
  nextSidePanelCommandNonce,
  type SidePanelRequest,
} from "@/components/chat/runtime/chat-session-model";
import { PageShell, panelChromeClassName } from "@/components/page-shell";
import { useChats } from "@/components/providers/chats-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { useHistory } from "@/components/providers/history/history-provider";
import { AgentBackendIcon } from "@/lib/agent-backends";
import { claimActiveChat } from "@/lib/chat-activity-store";
import { setDraftRouteProject, useDraftChatId } from "@/lib/chat-composer-store";
import { useDraftChatResidence } from "@/lib/draft-chat-residence";
import { chatExitRoute } from "@/lib/draft-route";
import { cn } from "@ai-chat/ui/lib/utils";
import { Button } from "@ai-chat/ui/components/ui/button";
// 第三栏在右侧，用 SidebarTrigger 同族的 Panel 图标；
// PanelRight 本就是 PanelLeft 的水平镜像，比给左向图标套 scale-x-[-1] 更正。
import { PanelRightIcon } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { adoptHistory } from "@/lib/history/client";
import { openProductDestination } from "@/lib/product-navigation";
import { AppEditorRouteGate } from "./app-editor-route-gate";
import { CHAT_PANEL_CAPABILITIES } from "../../shared/placement/facts";
import type { ForeignHistorySummary } from "../../shared/history-import-ipc";
import { useChatSession, type ChatProjectMode } from "@/components/chat/runtime/use-chat-session";
import { assembleFirstTurnPayload } from "@/components/chat/runtime/session/create-session-submit";
import type { PromptInputMessage } from "@ai-chat/ui/components/ai-elements/prompt-input";

export function ChatRoute({ surfaceVisible = true }: { surfaceVisible?: boolean }) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { chats, loading: chatsLoading } = useChats();
  const { projects, loading: projectsLoading } = useProjects();
  const setup = useSetup();
  const { snapshot: historySnapshot } = useHistory();
  const [sidePanelRequest, setSidePanelRequest] =
    useState<SidePanelRequest | null>(null);
  const draftChatId = useDraftChatId();
  const appEditAppId = searchParams.get("appEditAppId");
  const appEditIntent = searchParams.get("appEditIntent");
  const editorDraft = !id && Boolean(appEditAppId && appEditIntent);
  const chatId = id ?? (editorDraft ? appEditIntent! : draftChatId);
  // 进入即消费该会话的活动标记；离开只撤销自己的声明，跑完才可能重新标记。
  useEffect(() => (id ? claimActiveChat(id) : undefined), [id]);
  /* 换槽与发送后切页的唯一通道：草稿 id 一旦出现在列表里，驻留中的用户被
     带去那条 chat，弃稿则原地退役。裁决与成因详见 draft-chat-residence。 */
  useDraftChatResidence({ id: editorDraft ? appEditIntent! : id, chats, chatsLoading });
  useEffect(() => {
    if (!editorDraft || !chats.some((chat) => chat.id === appEditIntent)) return;
    navigate(`/chat/${encodeURIComponent(appEditIntent!)}`, { replace: true });
  }, [appEditIntent, chats, editorDraft, navigate]);
  /* 草稿的 Project 由路由说了算：`/` 就是根级，`/?projectId=X` 就是 X。整个
     产品里只有这里知道「路由发没发话」——query 缺席在草稿路由上是一句明确的
     「根级」，而在 `/chat/:id` 上什么也没说。把这两件事压成同一个 null 递给
     会话 hook，正是 Sidebar 的「+」清不掉上一个 Project 的成因：空白页于是
     写着别人的名字。落盘会话不在此列，故 id 在场直接退场。
     必须排在退役之后：提交那一刻槽会换代，退役先跑，本次写入拿着旧 id 撞不上
     活的 draftChatId，自然作废。 */
  const routeProjectId = searchParams.get("projectId");
  useEffect(() => {
    if (id) return;
    setDraftRouteProject(chatId, routeProjectId);
  }, [chatId, id, routeProjectId]);
  // 全屏 Base「收起」回流：路由 state 携带 openBase，落地即请求展开第三栏
  const arrivalState = location.state as {
    openBase?: boolean;
    openSidePanel?: "openShell" | "browser";
  } | null;
  const arrivalTarget = arrivalState?.openSidePanel ??
    (arrivalState?.openBase ? "base" : null);
  useEffect(() => {
    if (!id || !arrivalTarget) return;
    // 路由 state 是外部导航事件；这里只把一次性到达意图转成本地 nonce。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSidePanelRequest({
      conversationKey: id,
      command: {
        target: arrivalTarget,
        nonce: nextSidePanelCommandNonce(),
      },
    });
  }, [arrivalTarget, id]);
  /* 草稿路由永远没有 summary。草稿 id 稳定之后若还让它去 chats 里撞名，
     一次「已归档」判定就会让下面的守卫在 "/" 上把自己重定向成死循环。 */
  const summary = id ? chats.find((chat) => chat.id === id) : undefined;
  const canonicalHistory = id
    ? Object.entries(historySnapshot.canonicalRoutes).find(([, route]) => route.chatId === id)
    : undefined;
  const summaryContext = summary?.context;
  const importSegment = summary?.importOrigin
    ? {
        sourceStatus: summary.importOrigin.sourceStatus,
        incompleteTail: summary.importOrigin.incompleteTail,
      }
    : undefined;
  const panelAllowed = summaryContext
    ? CHAT_PANEL_CAPABILITIES[summaryContext.kind].base
    : false;
  useEffect(() => {
    if (!summary?.context || !summary.incarnationId) return;
    if (summary.context.kind !== "app-use") return;
    const destination = {
      kind: "app-use-chat" as const,
      appId: summary.context.appId,
      chatId: summary.id,
      incarnationId: summary.incarnationId,
    };
    void openProductDestination(
      destination,
      navigate,
      { replace: true }
    ).catch(() => undefined);
  }, [navigate, summary]);
  if (id && (chatsLoading || projectsLoading)) {
    return (
      <PageShell
        title={
          <span
            aria-hidden
            className="inline-block h-4 w-40 animate-pulse rounded-md bg-muted"
          />
        }
      >
        <div className="h-full" />
      </PageShell>
    );
  }
  /* 留不住这条 chat 时，去哪张空白页由 chatExitRoute 一处说了算：归档的
     若只是这条 chat，用户留在它所属 Project 的空白页上；Project 自己丢失
     或归档才回根级。哪种都不该被甩进 Archive 列表页。 */
  const exitRoute = summary ? chatExitRoute(summary, projects) : null;
  if (exitRoute) return <Navigate to={exitRoute} replace />;
  if (summary?.context?.kind === "app-use") {
    return <div className="h-full" role="status" aria-label={t("apps.usePanel.loading")} />;
  }
  /* 草稿路由（还没有 id）不给标题：这一页正中间已经在问「要做点什么」，
     页头再写一遍「新任务」只是重复，连同那条分隔线一起交还给空白。
     一发出第一条消息路由就有了 id，页头随之回来。 */
  const headerTitle = !id ? undefined : summary?.title === null ? (
    <>
      <span className="sr-only">{t("chat.generatingTitle")}</span>
      <span
        aria-hidden
        className="inline-block h-4 w-40 animate-pulse rounded-md bg-muted"
      />
    </>
  ) : (
    summary?.title ?? t("chat.newTask")
  );
  const backendStatus = setup.status?.backends.find(
    (backend) => backend.id === summary?.agent
  )?.status;
  const editorDestination =
    summaryContext?.kind === "app-edit" && summary?.incarnationId
      ? {
          kind: "app-editor-chat" as const,
          appId: summaryContext.appId,
          projectId: summaryContext.projectId,
          chatId: summary.id,
          incarnationId: summary.incarnationId,
        }
      : null;
  const projectMode: ChatProjectMode = editorDraft
    ? { kind: "fixed-app", appId: appEditAppId!, appRole: "edit" }
    : summaryContext?.kind === "app-edit"
      ? { kind: "fixed-app", appId: summaryContext.appId, appRole: "edit" }
      : { kind: "selectable" };

  const page = (
    <PageShell
      title={headerTitle}
      icon={
        summary && panelAllowed ? (
          <AgentBackendIcon
            backend={summary.agent}
            /* 未就绪时状态压过身份：整枚交给 currentColor 随语境变灰。 */
            tone={backendStatus === "ready" ? "brand" : "mono"}
            className={cn(
              "size-4",
              backendStatus !== "ready" && "text-muted-foreground"
            )}
          />
        ) : undefined
      }
      actions={
        summary && panelAllowed ? (
          <Button
            aria-label={t("chat.openSidePanel")}
            className={panelChromeClassName}
            onClick={() =>
              setSidePanelRequest({
                conversationKey: chatId,
                command: {
                  target: "openShell",
                  nonce: nextSidePanelCommandNonce(),
                },
              })
            }
            size="icon-lg"
            type="button"
            variant="ghost"
          >
            <PanelRightIcon />
          </Button>
        ) : undefined
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <SkillsOnboardingCard />
        <div className="min-h-0 flex-1">
          {summary?.readOnlyReason === "external-readonly" && canonicalHistory ? (
            <ImportedChatView
              key={chatId}
              chatId={chatId}
              history={canonicalHistory[1].summary}
              importSegment={importSegment}
              project={projectMode}
              sidePanelRequest={sidePanelRequest}
              surfaceVisible={surfaceVisible}
              onConsumeSidePanelRequest={(nonce) =>
                setSidePanelRequest((current) => consumeSidePanelRequest(current, nonce))
              }
            />
          ) : (
            <ChatView
              key={chatId}
              scope={{ conversationId: chatId }}
        /* 草稿与持久会话一视同仁地抢焦点：换 chat 即换 key 重挂，光标该在的地方
           永远是输入框——用户点侧栏是为了说话，不是为了先按一次 Tab。落点分歧
           由 RichInput 抹平（从外部进入落到内容末尾）。只有主聊天路由这样做：
           App 面板里的 Edit/Use chat 用户是先看 App 再决定说不说话，不抢。 */
        focusComposer
              project={projectMode}
              sidePanelRequest={sidePanelRequest}
              importSegment={importSegment}
              composerLockedReason={summary?.readOnlyReason === "external-readonly"
                ? t("chat.importedReadOnlyReason")
                : undefined}
              surfaceVisible={surfaceVisible}
              onConsumeSidePanelRequest={(nonce) =>
                setSidePanelRequest((current) => consumeSidePanelRequest(current, nonce))
              }
            />
          )}
        </div>
      </div>
    </PageShell>
  );
  return editorDestination ? (
    <AppEditorRouteGate destination={editorDestination}>
      {page}
    </AppEditorRouteGate>
  ) : page;
}

function ImportedChatView({
  chatId,
  history,
  importSegment,
  project,
  sidePanelRequest,
  surfaceVisible,
  onConsumeSidePanelRequest,
}: {
  chatId: string;
  history: ForeignHistorySummary;
  importSegment?: ImportSegmentFacts;
  project: ChatProjectMode;
  sidePanelRequest: SidePanelRequest | null;
  surfaceVisible: boolean;
  onConsumeSidePanelRequest(nonce: number): void;
}) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const session = useChatSession({ scope: { conversationId: chatId }, project });
  const { turnOptions, selectedBackend, planMode } = session.composer;
  const submit = useCallback(async (message: PromptInputMessage) => {
    const submission = assembleFirstTurnPayload({
      message,
      chatId,
      backend: turnOptions.backend,
      selectedBackend,
      planMode,
    });
    if (!submission.displayText && !submission.attachmentPayloads?.length) return;
    const receipt = await adoptHistory({
      opaqueId: history.opaqueId,
      expectedHistoryRevision: history.historyRevision,
      submission,
      turnOptions,
    });
    await navigate(`/chat/${encodeURIComponent(receipt.chatId)}`, { replace: true });
  }, [chatId, history.historyRevision, history.opaqueId, navigate, planMode, selectedBackend, turnOptions]);
  const composer = useMemo(() => ({
    ...session.composer,
    persisted: true,
    inputDisabled: session.composer.inputDisabled || !history.canResume,
    handleSubmit: submit,
    handleQueueOrSubmit: submit,
  }), [history.canResume, session.composer, submit]);
  const controller = useMemo(() => ({ ...session, composer }), [composer, session]);
  return (
    <ChatViewFrame
      /* 不能续聊时把原因说在输入框上：这是 main 唯一说过这句话的地方，
         也是用户此刻唯一会看的地方。 */
      composerLockedReason={
        history.canResume ? undefined : t("history.resumeUnavailable")
      }
      controller={controller}
      focusComposer
      importSegment={importSegment}
      sidePanelRequest={sidePanelRequest}
      surfaceVisible={surfaceVisible}
      onConsumeSidePanelRequest={onConsumeSidePanelRequest}
    />
  );
}
