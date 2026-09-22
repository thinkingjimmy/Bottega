/**
 * [INPUT]: Depends on router, i18n, Chats/Projects/Setup providers, canonical chat context, the exact App Editor route gate, draft routing/residence, the Agent connection warm-up client, PageShell, idle chunk prefetch, side-panel capability policy, and ChatView
 * [OUTPUT]: One ChatPage with selected local/cloud session ports and imported first turns, the cloud port warmed and kept resolved at idle so a residence change swaps ports in one commit and hands the caret back to the rebuilt composer; missing conversations never open draft composers
 * [POS]: The sole product chat route adapter in views
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ChatPage, type ChatPageRenderer } from "@ai-chat/chat-ui/chat-page";
import { ChatView, ChatViewFrame } from "@/components/chat/chat-view";
import type {
  ChatForkViewContext,
  ImportSegmentFacts,
} from "@/components/chat/transcript/chat-transcript";
import { SkillsOnboardingCard } from "@/components/chat/skills-onboarding-card";
import {
  consumeSidePanelRequest,
  nextSidePanelCommandNonce,
  type SidePanelRequest,
} from "@/components/chat/runtime/chat-session-model";
import { PageShell, DesktopWorkspaceHeader, panelChromeClassName } from "@/components/page-shell";
import { useChats } from "@/components/providers/chats-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { projectAvailability, submissionDecision } from "../../shared/agent-availability/projection";
import { useSetup } from "@/components/providers/setup-provider";
import { AgentBackendIcon } from "@/lib/agent-backends";
import { useConversationWarmup } from "@/lib/agent-connections-client";
import { claimActiveChat } from "@/lib/chat-activity-store";
import { setDraftRouteProject, useDraftChatId } from "@/lib/chat-composer-store";
import { useContinuationDraft } from "@/lib/cloud/chat/draft";
import { useDraftChatResidence } from "@/lib/draft-chat-residence";
import { chatExitRoute } from "@/lib/draft-route";
import { cn } from "@ai-chat/ui/lib/utils";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
// 第三栏在右侧，用 SidebarTrigger 同族的 Panel 图标；
// PanelRight 本就是 PanelLeft 的水平镜像，比给左向图标套 scale-x-[-1] 更正。
import { PanelRightIcon } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { submitHistoryAdoption } from "@/lib/chat-agent-draft/submission";
import { openProductDestination } from "@/lib/product-navigation";
import { AppEditorRouteGate } from "./app-editor-route-gate";
import { CHAT_PANEL_CAPABILITIES } from "../../shared/placement/facts";
import type { ChatSummary } from "../../shared/chats-ipc";
import { useChatSession, type ChatProjectMode } from "@/components/chat/runtime/use-chat-session";
import { assembleFirstTurnPayload } from "@/components/chat/runtime/session/create-session-submit";
import { onChatsEvent } from "@/lib/chats-client";
import type { PromptInputMessage } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { useCloudChatHead } from "@/lib/cloud/chat/catalog";
import { useCloudAccount } from "@/lib/cloud/client";
import { prefetchWhenIdle } from "@/lib/idle-prefetch";
/* Named loaders, not inline imports: `prefetchWhenIdle` keys its once-guard on loader identity.
   The resolved module is kept here as well: `lazy` suspends for at least one tick even on an
   already-fetched chunk, and that tick tears the columns down in the middle of a turn. */
let cloudSessionChunk: typeof import("./cloud-chat/session") | null = null;
const loadCloudSessionChunk = () => import("./cloud-chat/session").then(module => (cloudSessionChunk = module));
const loadCloudPageChunk = () => import("@ai-chat/chat-ui/page/cloud");
const NativeCloudStatus = lazy(() => import("./cloud-chat/native/status").then(module => ({ default: module.NativeCloudStatus })));
const NativeCloudComposer = lazy(() => import("./cloud-chat/native/status").then(module => ({ default: module.NativeCloudComposer })));

export function ChatRoute({ surfaceVisible = true }: { surfaceVisible?: boolean }) {
  return <ChatPage session={renderPage => <DesktopChatSession surfaceVisible={surfaceVisible} renderPage={renderPage} />} />;
}
function DesktopChatSession({ surfaceVisible, renderPage }: { surfaceVisible: boolean; renderPage: ChatPageRenderer }) {
  const { id } = useParams(), cloud = useCloudChatHead(id), account = useCloudAccount(), { chats, loading: chatsLoading } = useChats();
  const { t } = useAppTranslation();
  const draftChatId = useDraftChatId();
  const continuationDraft = useContinuationDraft(id, cloud.head?.chat.classification.conversationKind === "ordinary" ? cloud.head.chat.incarnationId : undefined, account.profile?.userId);
  const local = !id || chats.some(chat => chat.id === id);
  /* The route can follow a Chat into the cloud port with no warning. Warm both halves of that
     port while the thread is idle so the flip renders the conversation instead of a "Loading"
     shell over a turn the user is still steering. */
  const cloudCapable = Boolean(cloud.sources);
  useEffect(() => {
    if (!cloudCapable) return;
    const cancels = [prefetchWhenIdle(loadCloudSessionChunk), prefetchWhenIdle(loadCloudPageChunk)];
    return () => { for (const cancel of cancels) cancel(); };
  }, [cloudCapable]);
  const cloudHead = id && cloud.sources && cloud.head && (cloud.residence === "mirror" || cloud.head.ownerDeviceId !== account.deviceId) ? cloud.head : null;
  /* One conversation, two ports. Crossing between them is not navigation: the columns, the
     transcript position and the draft all stay, so the only thing the rebuilt tree owes the
     reader is the caret they were typing with. */
  const [port, setPort] = useState({ id, cloud: cloudHead !== null, swapped: false });
  // Only a port that moved under the same conversation is a swap; a different chat is navigation.
  if (port.id !== id || port.cloud !== (cloudHead !== null)) setPort({ id, cloud: cloudHead !== null, swapped: port.id === id });
  const [chunk, setChunk] = useState(cloudSessionChunk);
  if (!chunk && cloudSessionChunk) setChunk(cloudSessionChunk);
  const needsCloudPort = cloudHead !== null;
  useEffect(() => {
    if (!needsCloudPort || chunk) return;
    void loadCloudSessionChunk().then(setChunk).catch(() => {});
  }, [chunk, needsCloudPort]);
  if (id && !local && cloud.sources && cloud.head === undefined && !cloud.error) return <PageShell title={t("common.chats")}><p role="status">{t("common.loading")}</p></PageShell>;
  if (cloudHead && cloud.sources) {
    /* The cold-start placeholder is the page's own frame, not a loading shell: the columns must
       not change width between the two ports. */
    return chunk
      ? <chunk.DesktopCloudSession renderPage={renderPage} key={id} head={cloudHead} sources={cloud.sources} draft={continuationDraft} focusComposer={port.swapped} />
      : renderPage({ conversation: { empty: false, mounted: false, emptyView: null, fallback: null, transcript: null } });
  }
  if (conversationMissing({ id, chats, chatsLoading, draftChatId })) {
    /* The directory still recognizes this head but the local machine has no row for
       it at all — that can only mean it was deleted elsewhere and the local machine
       received the tombstone: say so precisely. Every other case (not signed in,
       switched accounts, never existed here) just says "not on this device". */
    const deleted = cloud.deleted || Boolean(cloud.head && !cloud.residence);
    return <PageShell title={t("common.chats")}>
      <p className="p-4 text-sm text-muted-foreground" role="status">{t(deleted ? "chat.cloud.deleted" : "chat.cloud.unavailable")}</p>
    </PageShell>;
  }
  return <LocalChatRoute renderPage={renderPage} surfaceVisible={surfaceVisible} cloudFacts={Boolean(cloud.head)} />;
}

/* The route points at a chat the local machine doesn't have: deleted elsewhere, or
   belonging to an account that isn't signed in right now. This must never fall
   through to the draft composer — that would bind the blank page to a dead id with
   nowhere for the user's typing to go. A live draft slot isn't in this list: it
   was never persisted in the first place, and the blank page is its home; nothing
   can be asserted before the list has finished loading either. */
export function conversationMissing({ id, chats, chatsLoading, draftChatId }: {
  id?: string;
  chats: readonly Pick<ChatSummary, "id">[];
  chatsLoading: boolean;
  draftChatId: string;
}) {
  return Boolean(id) && !chatsLoading && id !== draftChatId && !chats.some((chat) => chat.id === id);
}

function LocalChatRoute({ surfaceVisible = true, cloudFacts = false, renderPage }: { surfaceVisible?: boolean; cloudFacts?: boolean; renderPage: ChatPageRenderer }) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { chats, loading: chatsLoading } = useChats();
  const { projects, loading: projectsLoading } = useProjects();
  const setup = useSetup();
  const [sidePanelRequest, setSidePanelRequest] =
    useState<SidePanelRequest | null>(null);
  const [truncatedChatId, setTruncatedChatId] = useState<string | null>(null);
  const draftChatId = useDraftChatId();
  const appEditAppId = searchParams.get("appEditAppId");
  const appEditIntent = searchParams.get("appEditIntent");
  const editorDraft = !id && Boolean(appEditAppId && appEditIntent);
  const chatId = id ?? (editorDraft ? appEditIntent! : draftChatId);
  const recoveryTruncated = Boolean(id && truncatedChatId === id);
  useEffect(() => {
    if (!id) return;
    const unsubscribe = onChatsEvent((event) => {
      if (event.type === "recovery-truncated" && event.chatId === id) {
        setTruncatedChatId(id);
      }
    });
    /* 一次性披露：离开这条 Chat 就清掉，回来不再重复提示。 */
    return () => {
      unsubscribe();
      setTruncatedChatId(null);
    };
  }, [id]);
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
  /* 续聊许可来自 Chat 自己的导入身份。这里曾在 history 索引的 canonicalRoutes
     里反查这条 Chat——那份索引住在 userData，换档案或从文件夹恢复必然为空，
     于是一条完好的导入 Chat 会莫名其妙地只读。 */
  const importedContinuation = Boolean(summary?.importOrigin) &&
    summary?.readOnlyReason === "external-readonly";
  const summaryContext = summary?.context;
  const importSegment = summary?.importOrigin
    ? { sourceStatus: summary.importOrigin.sourceStatus }
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
  /* 预热只认「已解析的后端」：空白草稿的后端由 composer 自己说了算，这里
     宁可不发，也不能拿默认值替用户挑一家去占进程（Lab 开关关闭时全静默）。 */
  useConversationWarmup(summary?.agent ? { conversationId: chatId, backend: summary.agent } : null);
  if (id && (chatsLoading || projectsLoading)) {
    return (
      <PageShell
        title={
          <Skeleton
            aria-hidden
            className="inline-block h-4 w-40 motion-reduce:animate-none"
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
      <Skeleton
        aria-hidden
        className="inline-block h-4 w-40 motion-reduce:animate-none"
      />
    </>
  ) : (
    summary?.title ?? t("chat.newTask")
  );
  const backend = setup.status?.backends.find(
    (candidate) => candidate.id === summary?.agent
  );
  const backendState = projectAvailability(backend, setup.now).state;
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
  const forkContext: ChatForkViewContext | undefined = summary
    ? {
        summary,
        parent: summary.parentChatId
          ? chats.find((chat) =>
              chat.id === summary.parentChatId &&
              chat.incarnationId === summary.parentIncarnationId
            ) ?? null
          : null,
        navigateToChat: (targetChatId, messageId) => {
          const query = messageId ? `?m=${encodeURIComponent(messageId)}` : "?fork=divider";
          navigate(`/chat/${encodeURIComponent(targetChatId)}${query}`);
        },
      }
    : undefined;

  const header = (
    <DesktopWorkspaceHeader
      title={headerTitle}
      icon={
        summary && panelAllowed ? (
          <AgentBackendIcon
            backend={summary.agent}
            /* 未就绪时状态压过身份：整枚交给 currentColor 随语境变灰。 */
            tone="brand"
            aria-label={`${summary.agent} · ${t(`agentAvailability.state.${backendState}`)}`}
            className={cn(
              "size-4",
              backendState !== "ready" && "text-muted-foreground"
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
    />
  );
  const notices = <>
        <SkillsOnboardingCard />
        {id && cloudFacts && window.cloudChat && <Suspense fallback={null}><NativeCloudStatus chatId={id} /></Suspense>}
        {recoveryTruncated && (
          <div className="mx-3 mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs" role="status">
            {t("chat.fork.recoveryTruncated")}
          </div>
        )}
  </>;
  const page = (
          importedContinuation ? (
            <ImportedChatView
              renderPage={renderPage}
              key={chatId}
              header={header}
              notices={notices}
              chatId={chatId}
              importSegment={importSegment}
              forkContext={forkContext}
              project={projectMode}
              sidePanelRequest={sidePanelRequest}
              surfaceVisible={surfaceVisible}
              onConsumeSidePanelRequest={(nonce) =>
                setSidePanelRequest((current) => consumeSidePanelRequest(current, nonce))
              }
            />
          ) : (
            <ChatView
              renderPage={renderPage}
              key={chatId}
              header={header}
              notices={notices}
              existingChat={Boolean(summary)}
              scope={{ conversationId: chatId }}
              composerWrapper={id && cloudFacts ? composer => <Suspense fallback={composer}><NativeCloudComposer chatId={id}>{composer}</NativeCloudComposer></Suspense> : undefined}
        /* 草稿与持久会话一视同仁地抢焦点：换 chat 即换 key 重挂，光标该在的地方
           永远是输入框——用户点侧栏是为了说话，不是为了先按一次 Tab。落点分歧
           由 RichInput 抹平（从外部进入落到内容末尾）。只有主聊天路由这样做：
           App 面板里的 Edit/Use chat 用户是先看 App 再决定说不说话，不抢。 */
        focusComposer
              project={projectMode}
              sidePanelRequest={sidePanelRequest}
              importSegment={importSegment}
              managedWorktree={summary?.executionKind === "managed-worktree"}
              forkContext={forkContext}
              surfaceVisible={surfaceVisible}
              onConsumeSidePanelRequest={(nonce) =>
                setSidePanelRequest((current) => consumeSidePanelRequest(current, nonce))
              }
            />
          )
  );
  return editorDestination ? (
    <AppEditorRouteGate destination={editorDestination}>
      {page}
    </AppEditorRouteGate>
  ) : page;
}

/* 一条导入 Chat 看起来就是普通聊天：普通 composer，没有告示，也没有「将从
   已保存的历史继续」。收养还是重放由 main 静默择一，转录里那条分隔线是唯一
   可见的痕迹。这里与 ChatView 的唯一差别是首轮走续聊入口而不是新建会话。 */
function ImportedChatView({
  renderPage,
  header,
  notices,
  chatId,
  importSegment,
  forkContext,
  project,
  sidePanelRequest,
  surfaceVisible,
  onConsumeSidePanelRequest,
}: {
  renderPage: ChatPageRenderer;
  header: React.ReactNode;
  notices: React.ReactNode;
  chatId: string;
  importSegment?: ImportSegmentFacts;
  forkContext?: ChatForkViewContext;
  project: ChatProjectMode;
  sidePanelRequest: SidePanelRequest | null;
  surfaceVisible: boolean;
  onConsumeSidePanelRequest(nonce: number): void;
}) {
  const { t } = useAppTranslation();
  const session = useChatSession({ scope: { conversationId: chatId }, project });
  const { turnOptions, selectedBackend, planMode } = session.composer;
  const submit = useCallback(async (message: PromptInputMessage, options?: { authenticationRetry?: import("../../shared/agent-availability/types").AuthenticationRetryIntent }) => {
    const decision = submissionDecision(selectedBackend, Date.now());
    if (decision.decision !== "allow" && !(options?.authenticationRetry && decision.reason === "auth-required")) throw new Error(t("agentAvailability.blocked", { backend: selectedBackend?.displayName ?? turnOptions.backend }));
    const submission = assembleFirstTurnPayload({
      message,
      chatId,
      backend: turnOptions.backend,
      selectedBackend,
      planMode,
    });
    if (!submission.displayText && !submission.attachmentPayloads?.length) return;
    await submitHistoryAdoption(chatId, {
      ...(options?.authenticationRetry ? { authenticationRetry: options.authenticationRetry } : {}),
      chatId,
      submission,
      turnOptions,
    });
  }, [chatId, planMode, selectedBackend, t, turnOptions]);
  const composer = useMemo(() => ({
    ...session.composer,
    persisted: true,
    handleSubmit: submit,
  }), [session.composer, submit]);
  const controller = useMemo(() => ({ ...session, composer }), [composer, session]);
  return (
    <ChatViewFrame
      renderPage={renderPage}
      header={header}
      notices={notices}
      /* An imported conversation is history by definition: it always has
         messages to wait for. */
      existingChat
      controller={controller}
      focusComposer
      importSegment={importSegment}
      forkContext={forkContext}
      sidePanelRequest={sidePanelRequest}
      surfaceVisible={surfaceVisible}
      onConsumeSidePanelRequest={onConsumeSidePanelRequest}
    />
  );
}
