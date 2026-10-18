/**
 * [INPUT]: React, explicit local-file failure translation keys, localized panel copy, session identity, Browser/Plan/Subagent projections and scoped workspace/file-link readers
 * [OUTPUT]: Stable panel commands and generation-fenced previews shared by composer references and message file links
 * [POS]: apps/desktop/src/components/chat/runtime/session/panels; The sole side-panel state owner in chat/runtime/session
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import type { ChatStatus } from "ai";
import type {
  RichNode,
  RichValue,
} from "@ai-chat/ui/components/ai-elements/prompt-input";
import type { ChatMessage } from "../../../../../../shared/ipc/content/chats-ipc";
import type { AgentWorkspaceScope } from "../../../../../../shared/ipc/agent/agent-ipc";
import {
  projectDraftPlan,
  type DraftPlanProjection,
  type TurnDraft,
} from "../../../../../../shared/chats/model/chat-turn-reducer";
import { errorMessage, failureCode } from "@ai-chat/ui/lib/errors";
import {
  readWorkspaceFile,
  resignWorkspaceFile,
  resolveWorkspaceFileLink,
} from "@/lib/clients/workspace-files-client";
import type { WorkspaceFileReadResult } from "../../../../../../shared/ipc/workspace/workspace-files-ipc";
import type { ProjectedSubagent } from "@/lib/chat/session/chat-turn-attach";
import {
  MARKDOWN_PATTERN,
  MARKDOWN_PREVIEW_LIMIT,
  nextSidePanelCommandNonce,
  panelConversationKey,
  panelEligibility,
  panelGenerationKey,
  type ConversationImageSource,
  type PanelSessionContext,
  type SidePanelTabCommand,
  type SidePanelTabCommandInput,
  type SidePanelState,
} from "../../chat-session-model";
import type {
  BrowserBridgeApi,
  BrowserTabsSnapshot,
} from "../../../../../../shared/ipc/workspace/browser-ipc";
import { recallSidePanel, rememberSidePanel } from "./side-panel-memory";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";

declare global {
  interface Window {
    browser?: BrowserBridgeApi;
  }
}

type SidePanelInput = {
  conversationId: string;
  panelContext: PanelSessionContext;
  draft: TurnDraft | null;
  messages: ChatMessage[];
  status: ChatStatus;
  subagents: Record<string, ProjectedSubagent>;
  fileFor: (nodeId: string) => File | undefined;
  workspaceScope: AgentWorkspaceScope;
  workspaceScopeKey: string;
  /** A background queue runner (F-34c) has no panel: it never reads or writes the Chat's remembered panel, nor opens one. */
  detached?: boolean;
};

export function reconcilePlanPanel(
  current: SidePanelState,
  draft: TurnDraft | null,
  messages: readonly ChatMessage[],
  status: ChatStatus,
  titles: Readonly<{ editing: string; plan: string }>
): SidePanelState {
  if (current.kind !== "plan" || !current.planItemId) return current;
  const livePlan = draft ? projectDraftPlan(draft) : null;
  if (livePlan?.itemId === current.planItemId) {
    const title = livePlan.editing ? titles.editing : titles.plan;
    return current.content === livePlan.content && current.title === title
      ? current
      : { ...current, content: livePlan.content, title };
  }
  if (draft || status !== "ready") return current;
  const finalPlan = [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        message.kind === "plan" &&
        message.content === current.content
    );
  return finalPlan
    ? {
        kind: "plan",
        messageId: finalPlan.id,
        content: finalPlan.content,
        title: titles.plan,
      }
    : { kind: "none" };
}

export function useSessionSidePanel({
  conversationId,
  panelContext,
  draft,
  messages,
  status,
  subagents,
  fileFor,
  workspaceScope,
  workspaceScopeKey,
  detached = false,
}: SidePanelInput) {
  const { t } = useAppTranslation();
  const planTitles = useMemo(
    () => ({
      editing: t("chat.transcript.plan.editing"),
      plan: t("chat.transcript.plan.title"),
    }),
    [t]
  );
  const conversationKey = panelConversationKey(panelContext);
  const generationKey = panelGenerationKey(panelContext);
  const conversationContext = panelContext.conversationContext;
  const context = useMemo<PanelSessionContext>(
    () => panelContext.kind === "draft"
      ? {
          kind: "draft",
          draftKey: conversationKey,
          ...(conversationContext ? { conversationContext } : {}),
        }
      : {
          kind: panelContext.kind,
          productRef: {
            chatId: conversationKey,
            incarnationId: generationKey,
          },
          ...(conversationContext ? { conversationContext } : {}),
        },
    [conversationContext, conversationKey, generationKey, panelContext.kind]
  );
  const recall = useCallback(
    (target: PanelSessionContext): SidePanelState => detached ? { kind: "none" } : recallSidePanel(target),
    [detached]
  );
  const [scopedState, setScopedState] = useState(() => ({
    conversationKey,
    generationKey,
    context,
    state: recall(context),
  }));
  const state = scopedState.state;
  const setState = useCallback((next: SetStateAction<SidePanelState>) => {
    setScopedState((current) => {
      const state = typeof next === "function" ? next(current.state) : next;
      return state === current.state ? current : { ...current, state };
    });
  }, []);
  const subagentsRef = useRef(subagents);
  useLayoutEffect(() => {
    subagentsRef.current = subagents;
  }, [subagents]);
  const workspaceGeneration = useRef(0);
  const workspaceFence = `${conversationKey}\u0000${generationKey}\u0000${workspaceScopeKey}`;
  const workspaceFenceRef = useRef(workspaceFence);

  useLayoutEffect(() => {
    setScopedState((current) => {
      if (current.conversationKey !== conversationKey) {
        return {
          conversationKey,
          generationKey,
          context,
          state: recall(context),
        };
      }
      if (current.generationKey === generationKey) {
        return current;
      }
      return {
        conversationKey,
        generationKey,
        context,
        state:
          current.generationKey === "" && current.state.kind !== "none"
            ? current.state.kind === "tabs"
              ? { ...current.state, context }
              : current.state
            : recall(context),
      };
    });
  }, [context, conversationKey, generationKey, recall]);

  useLayoutEffect(() => {
    if (workspaceFenceRef.current === workspaceFence) return;
    workspaceFenceRef.current = workspaceFence;
    workspaceGeneration.current += 1;
    setState((current) =>
      current.kind === "workspace-preview" ? { kind: "none" } : current
    );
  }, [setState, workspaceFence]);

  // ChatView 按 chatId 重挂载，第三栏的开合便不能只活在挂载里：
  // 存在挂载之外，侧边栏切走再切回才不等于替用户按了一次关闭。
  useEffect(() => {
    if (!detached) rememberSidePanel(scopedState.context, scopedState.state);
  }, [detached, scopedState]);

  useEffect(() => {
    setState((current) =>
      reconcilePlanPanel(current, draft, messages, status, planTitles)
    );
  }, [draft, messages, planTitles, setState, status]);

  // 只有 createTab 那一次投影携带 createdTabId：本 chat 名下新 tab 出现的
  // 瞬间自发亮出 Browser 面板，历史 tab 与他 chat 事件永不误触发。
  useEffect(() => {
    const bridge = window.browser;
    if (!bridge || detached) return;
    return bridge.onTabsChanged((snapshot: BrowserTabsSnapshot) => {
      const created = snapshot.tabs.find(
        (tab) =>
          tab.tabId === snapshot.createdTabId &&
          tab.ownerChatId === conversationId
      );
      if (!created) return;
      setState({
        kind: "tabs",
        context,
        command: {
          target: "browser",
          nonce: nextSidePanelCommandNonce(),
        },
      });
    });
  }, [context, conversationId, detached, setState]);

  const close = useCallback(() => {
    workspaceGeneration.current += 1;
    setState({ kind: "none" });
  }, [setState]);
  const openTabs = useCallback(
    (input: SidePanelTabCommandInput | SidePanelTabCommand) => {
      const command = "nonce" in input
        ? input
        : { ...input, nonce: nextSidePanelCommandNonce() };
      if (command.target === "openShell") {
        setState({ kind: "tabs", context });
        return;
      }
      const capability = command.target === "image"
        ? "image"
        : command.target;
      const eligibility = panelEligibility(context, capability);
      setState(
        eligibility.allowed
          ? { kind: "tabs", context, command }
          : { kind: "tabs", context }
      );
    },
    [context, setState]
  );
  const openImage = useCallback(
    (source: ConversationImageSource) => {
      if (!panelEligibility(context, "image").allowed) return;
      setState({
        kind: "tabs",
        context,
        command: {
          target: "image",
          source,
          nonce: nextSidePanelCommandNonce(),
        },
      });
    },
    [context, setState]
  );
  const openSubagent = useCallback(
    (agentThreadId: string) => {
      if (
        panelEligibility(context, "subagents").allowed &&
        subagentsRef.current[agentThreadId]
      ) {
        setState({
          kind: "tabs",
          context,
          command: {
            target: "subagents",
            agentThreadId,
            nonce: nextSidePanelCommandNonce(),
          },
        });
      }
    },
    [context, setState]
  );
  const openArtifact = useCallback((fence: import("../../../../../../shared/ipc/apps/artifact-ipc").ArtifactFence) => setState({ kind: "artifact-preview", fence }), [setState]);
  const openPlan = useCallback((message: ChatMessage) => {
    if (message.role !== "assistant" || message.kind !== "plan") return;
    setState({
      kind: "plan",
      messageId: message.id,
      content: message.content,
      title: planTitles.plan,
    });
  }, [planTitles.plan, setState]);
  const openDraftPlan = useCallback((plan: DraftPlanProjection) => {
    setState({
      kind: "plan",
      messageId: plan.itemId,
      planItemId: plan.itemId,
      content: plan.content,
      title: plan.editing ? planTitles.editing : planTitles.plan,
    });
  }, [planTitles.editing, planTitles.plan, setState]);
  const reconcileRichValue = useCallback((value: RichValue) => {
    setState((current) =>
      (current.kind === "file" || current.kind === "workspace-preview") &&
      !(current.kind === "workspace-preview" && current.localFile) &&
      !value.some((node) => node.id === current.nodeId)
        ? { kind: "none" }
        : current
    );
  }, [setState]);
  const closeFile = useCallback(() => {
    setState((current) =>
      current.kind === "file" || current.kind === "workspace-preview"
        ? { kind: "none" }
        : current
    );
  }, [setState]);
  const openFile = useCallback(
    async (node: Extract<RichNode, { type: "file" }>) => {
      if (!MARKDOWN_PATTERN.test(node.name)) return;
      const file = fileFor(node.id);
      if (!file) return;
      setState({
        kind: "file",
        nodeId: node.id,
        filename: node.name,
        content: "",
        loading: true,
      });
      try {
        if (file.size > MARKDOWN_PREVIEW_LIMIT) {
          throw new Error("Markdown 预览不能超过 1 MB");
        }
        const content = await file.text();
        setState((current) =>
          current.kind === "file" && current.nodeId === node.id
            ? { ...current, content, loading: false }
            : current
        );
      } catch (cause) {
        setState((current) =>
          current.kind === "file" && current.nodeId === node.id
            ? { ...current, loading: false, error: errorMessage(cause) }
            : current
        );
      }
    },
    [fileFor, setState]
  );

  const openWorkspacePreview = useCallback(
    async (nodeId: string, filename: string, load: () => Promise<{
      result: WorkspaceFileReadResult;
      path?: string;
      workspaceIdentity?: string;
    }>, href?: string) => {
      const generation = ++workspaceGeneration.current;
      const localFile = href ? { href, scope: workspaceScope } : undefined;
      setState({
        kind: "workspace-preview",
        nodeId,
        filename,
        status: "loading",
        ...(localFile ? { localFile } : {}),
      });
      try {
        const { result, path, workspaceIdentity } = await load();
        setState((current) => {
          if (
            current.kind !== "workspace-preview" ||
            current.nodeId !== nodeId ||
            generation !== workspaceGeneration.current
          ) return current;
          const next = { ...current, filename: path ?? current.filename,
            ...(localFile ? { localFile: { ...localFile, workspaceIdentity } } : {}) };
          if (result.kind === "text") {
            return { ...next, status: "text", content: result.content };
          }
          if (result.kind === "metadata") {
            return {
              ...next,
              status: "metadata",
              size: result.size,
              mtimeMs: result.mtimeMs,
              reason: result.reason,
            };
          }
          return {
            ...next,
            status: "metadata",
            size: result.size,
            mtimeMs: result.mtimeMs,
            reason: "binary",
          };
        });
      } catch (cause) {
        const message = errorMessage(cause);
        const code = failureCode(cause);
        const key = /WORKSPACE_FILE_LINK_(?:OUTSIDE|CHANGED)/.test(code) ? "chat.sidePanel.file.outside"
          : code === "WORKSPACE_FILE_LINK_MISSING" ? "chat.sidePanel.file.missing" : "chat.sidePanel.file.readFailed";
        setState((current) =>
          current.kind === "workspace-preview" &&
          current.nodeId === nodeId &&
          generation === workspaceGeneration.current
            ? { ...current, status: "error", error: localFile ? t(key) : message }
            : current
        );
      }
    },
    [setState, workspaceScope, t]
  );

  const openWorkspaceFile = useCallback(async (node: Extract<RichNode, { type: "workspace-file" }>) => {
    if (node.entryKind === "dir") return;
    await openWorkspacePreview(node.id, node.path, async () => {
      const readRef = await resignWorkspaceFile({ scope: workspaceScope, path: node.path, entryKind: "file" });
      return { result: await readWorkspaceFile({ scope: workspaceScope, readRef }) };
    });
  }, [openWorkspacePreview, workspaceScope]);

  const openLocalFile = useCallback(async (href: string) => {
    await openWorkspacePreview(`link:${href}`, href, async () => {
      const target = await resolveWorkspaceFileLink({ scope: workspaceScope, href });
      return { result: await readWorkspaceFile({ scope: workspaceScope, readRef: target.readRef }),
        path: target.path, workspaceIdentity: target.workspaceIdentity };
    }, href);
  }, [openWorkspacePreview, workspaceScope]);

  return useMemo(() => ({
    state,
    close,
    closeFile,
    openTabs,
    openDraftPlan,
    openFile,
    openWorkspaceFile,
    openLocalFile,
    openImage,
    openArtifact,
    openPlan,
    openSubagent,
    reconcileRichValue,
  }), [
    close,
    closeFile,
    openDraftPlan,
    openFile,
    openImage,
    openArtifact,
    openPlan,
    openSubagent,
    openTabs,
    openWorkspaceFile,
    openLocalFile,
    reconcileRichValue,
    state,
  ]);
}
