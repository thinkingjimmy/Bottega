/**
 * [INPUT]: Depends on router, i18n, Chats/Projects/Setup providers, draft routing/residence policy, adopted prefix client/projector, PageShell, Skills onboarding card, side-panel commands, and ChatView
 * [OUTPUT]: Provides ChatRoute for draft/product/adopted chats, draft-persisted navigation (the sole post-send page switch), the one-time Skills discovery entry, Project exit guards, Project-draft Settings entry, and side-panel arrival commands
 * [POS]: The sole product chat route adapter in views
 */

import { useEffect, useState } from "react";
import type { HistoryPrefixProjection } from "@/lib/history-prefix";
import { projectAdoptedHistoryPrefix } from "@/lib/history-prefix";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router";
import { ChatView } from "@/components/chat/chat-view";
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
import { AgentBackendIcon } from "@/lib/agent-backends";
import { claimActiveChat } from "@/lib/chat-activity-store";
import { setDraftRouteProject, useDraftChatId } from "@/lib/chat-composer-store";
import { useDraftChatResidence } from "@/lib/draft-chat-residence";
import { chatExitRoute, projectAlive, projectSettingsRoute } from "@/lib/draft-route";
import { cn } from "@ai-chat/ui/lib/utils";
import { Button } from "@ai-chat/ui/components/ui/button";
// 第三栏在右侧，用 SidebarTrigger 同族的 Panel 图标；
// PanelRight 本就是 PanelLeft 的水平镜像，比给左向图标套 scale-x-[-1] 更正。
import { PanelRightIcon, Settings } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { historyAdoptionPrefix } from "@/lib/history/client";

type HistoryPrefixState = Readonly<{
  chatId: string;
  value: HistoryPrefixProjection | null;
}>;

export function ChatRoute({ surfaceVisible = true }: { surfaceVisible?: boolean }) {
  const { t } = useAppTranslation();
  const { id } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { chats, loading: chatsLoading } = useChats();
  const { projects, loading: projectsLoading } = useProjects();
  const setup = useSetup();
  const [sidePanelRequest, setSidePanelRequest] =
    useState<SidePanelRequest | null>(null);
  const [historyPrefixState, setHistoryPrefixState] =
    useState<HistoryPrefixState | null>(null);
  const draftChatId = useDraftChatId();
  const chatId = id ?? draftChatId;
  const historyPrefix =
    id && historyPrefixState?.chatId === id ? historyPrefixState.value : null;
  // 进入即消费该会话的活动标记；离开只撤销自己的声明，跑完才可能重新标记。
  useEffect(() => (id ? claimActiveChat(id) : undefined), [id]);
  useEffect(() => {
    let current = true;
    if (!id) return;
    void historyAdoptionPrefix(id)
      .then((value) => {
        if (current) {
          setHistoryPrefixState({
            chatId: id,
            value: value ? projectAdoptedHistoryPrefix(value) : null,
          });
        }
      })
      .catch(() => {
        if (current) setHistoryPrefixState({ chatId: id, value: null });
      });
    return () => { current = false; };
  }, [id]);
  /* 换槽与发送后切页的唯一通道：草稿 id 一旦出现在列表里，驻留中的用户被
     带去那条 chat，弃稿则原地退役。裁决与成因详见 draft-chat-residence。 */
  useDraftChatResidence({ id, chats, chatsLoading });
  /* 草稿的 Project 由路由说了算：`/` 就是根级，`/?projectId=X` 就是 X。整个
     产品里只有这里知道「路由发没发话」——query 缺席在草稿路由上是一句明确的
     「根级」，而在 `/chat/:id` 上什么也没说。把这两件事压成同一个 null 递给
     会话 hook，正是 Sidebar 的「+」清不掉上一个 Project 的成因：空白页于是
     写着别人的名字。落盘会话不在此列，故 id 在场直接退场。
     必须排在退役之后：提交那一刻槽会换代，退役先跑，本次写入拿着旧 id 撞不上
     活的 draftChatId，自然作废。 */
  const routeProjectId = searchParams.get("projectId");
  const routeProject = projects.find((project) => project.id === routeProjectId);
  useEffect(() => {
    if (id) return;
    setDraftRouteProject(draftChatId, routeProjectId);
  }, [draftChatId, id, routeProjectId]);
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

  return (
    <PageShell
      title={headerTitle}
      icon={
        summary ? (
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
        summary ? (
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
        ) : !id && routeProjectId && projectAlive(routeProject) ? (
          <Button
            aria-label={t("projectSettings.open")}
            asChild
            className={panelChromeClassName}
            size="icon-lg"
            variant="ghost"
          >
            <Link to={projectSettingsRoute(routeProjectId)}>
              <Settings />
            </Link>
          </Button>
        ) : undefined
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <SkillsOnboardingCard />
        <div className="min-h-0 flex-1">
          <ChatView
            key={chatId}
        scope={{ conversationId: chatId }}
        /* 草稿与持久会话一视同仁地抢焦点：换 chat 即换 key 重挂，光标该在的地方
           永远是输入框——用户点侧栏是为了说话，不是为了先按一次 Tab。落点分歧
           由 RichInput 抹平（从外部进入落到内容末尾）。只有主聊天路由这样做：
           App 面板里的 Edit/Use chat 用户是先看 App 再决定说不说话，不抢。 */
        focusComposer
        project={{ kind: "selectable" }}
        sidePanelRequest={sidePanelRequest}
        historyPrefix={historyPrefix}
        surfaceVisible={surfaceVisible}
            onConsumeSidePanelRequest={(nonce) =>
              setSidePanelRequest((current) => consumeSidePanelRequest(current, nonce))
            }
          />
        </div>
      </div>
    </PageShell>
  );
}
