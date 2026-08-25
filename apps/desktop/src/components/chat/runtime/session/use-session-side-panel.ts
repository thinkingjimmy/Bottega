/**
 * [INPUT]: Depends on React, Browser, Chat, Stream, Subagent Projections, rich file resources, Workspace readRef client, session, pure model and side-panel memory
 * [OUTPUT]: Provides identity-stable useSessionSidePanel, unified tabs/Plan/File/Workspace preview; Subagent Navigation through ref Read the latest projections, Workspace Read the scope + incarnation generation fence
 * [POS]: The third-party status owner of chat/runtime/session; Workspace content is read only through main capability, use-chat-session consume only stable controller
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
import type { ChatMessage } from "../../../../../shared/chats-ipc";
import type { AgentWorkspaceScope } from "../../../../../shared/agent-ipc";
import {
  projectDraftPlan,
  type DraftPlanProjection,
  type TurnDraft,
} from "../../../../../shared/chat-turn-reducer";
import { errorMessage } from "@/lib/errors";
import {
  readWorkspaceFile,
  resignWorkspaceFile,
} from "@/lib/workspace-files-client";
import type { ProjectedSubagent } from "@/lib/chat-turn-attach";
import {
  MARKDOWN_PATTERN,
  MARKDOWN_PREVIEW_LIMIT,
  nextSidePanelCommandNonce,
  type ConversationImageSource,
  type SidePanelTabCommand,
  type SidePanelTabCommandInput,
  type SidePanelState,
} from "../chat-session-model";
import type {
  BrowserBridgeApi,
  BrowserTabsSnapshot,
} from "../../../../../shared/browser-ipc";
import { recallSidePanel, rememberSidePanel } from "./side-panel-memory";

declare global {
  interface Window {
    browser?: BrowserBridgeApi;
  }
}

type SidePanelInput = {
  conversationId: string;
  incarnationId: string | null;
  draft: TurnDraft | null;
  messages: ChatMessage[];
  status: ChatStatus;
  subagents: Record<string, ProjectedSubagent>;
  fileFor: (nodeId: string) => File | undefined;
  workspaceScope: AgentWorkspaceScope;
  workspaceScopeKey: string;
};

export function reconcilePlanPanel(
  current: SidePanelState,
  draft: TurnDraft | null,
  messages: readonly ChatMessage[],
  status: ChatStatus
): SidePanelState {
  if (current.kind !== "plan" || !current.planItemId) return current;
  const livePlan = draft ? projectDraftPlan(draft) : null;
  if (livePlan?.itemId === current.planItemId) {
    const title = livePlan.editing ? "Editing" : "Plan";
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
        title: "Plan",
      }
    : { kind: "none" };
}

export function useSessionSidePanel({
  conversationId,
  incarnationId,
  draft,
  messages,
  status,
  subagents,
  fileFor,
  workspaceScope,
  workspaceScopeKey,
}: SidePanelInput) {
  const [scopedState, setScopedState] = useState(() => ({
    conversationId,
    incarnationId,
    state: recallSidePanel(conversationId, incarnationId),
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
  const workspaceFence = `${conversationId}\u0000${incarnationId ?? ""}\u0000${workspaceScopeKey}`;
  const workspaceFenceRef = useRef(workspaceFence);

  useLayoutEffect(() => {
    setScopedState((current) => {
      if (current.conversationId !== conversationId) {
        return {
          conversationId,
          incarnationId,
          state: recallSidePanel(conversationId, incarnationId),
        };
      }
      if (!incarnationId || current.incarnationId === incarnationId) {
        return current;
      }
      return {
        conversationId,
        incarnationId,
        state:
          current.incarnationId === null && current.state.kind !== "none"
            ? current.state
            : recallSidePanel(conversationId, incarnationId),
      };
    });
  }, [conversationId, incarnationId]);

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
    rememberSidePanel(
      scopedState.conversationId,
      scopedState.incarnationId,
      scopedState.state
    );
  }, [scopedState]);

  useEffect(() => {
    setState((current) => reconcilePlanPanel(current, draft, messages, status));
  }, [draft, messages, setState, status]);

  // 只有 createTab 那一次投影携带 createdTabId：本 chat 名下新 tab 出现的
  // 瞬间自发亮出 Browser 面板，历史 tab 与他 chat 事件永不误触发。
  useEffect(() => {
    const bridge = window.browser;
    if (!bridge) return;
    return bridge.onTabsChanged((snapshot: BrowserTabsSnapshot) => {
      const created = snapshot.tabs.find(
        (tab) =>
          tab.tabId === snapshot.createdTabId &&
          tab.ownerChatId === conversationId
      );
      if (!created) return;
      setState({
        kind: "tabs",
        chatId: conversationId,
        command: {
          target: "browser",
          nonce: nextSidePanelCommandNonce(),
        },
      });
    });
  }, [conversationId, setState]);

  const close = useCallback(() => {
    workspaceGeneration.current += 1;
    setState({ kind: "none" });
  }, [setState]);
  const openTabs = useCallback(
    (
      chatId: string,
      input: SidePanelTabCommandInput | SidePanelTabCommand
    ) => {
      const command = "nonce" in input
        ? input
        : { ...input, nonce: nextSidePanelCommandNonce() };
      setState({ kind: "tabs", chatId, command });
    },
    [setState]
  );
  const openImage = useCallback(
    (source: ConversationImageSource) => {
      setState({
        kind: "tabs",
        chatId: conversationId,
        command: {
          target: "image",
          source,
          nonce: nextSidePanelCommandNonce(),
        },
      });
    },
    [conversationId, setState]
  );
  const openSubagent = useCallback(
    (agentThreadId: string) => {
      if (subagentsRef.current[agentThreadId]) {
        setState({
          kind: "tabs",
          chatId: conversationId,
          command: {
            target: "subagents",
            agentThreadId,
            nonce: nextSidePanelCommandNonce(),
          },
        });
      }
    },
    [conversationId, setState]
  );
  const openPlan = useCallback((message: ChatMessage) => {
    if (message.role !== "assistant" || message.kind !== "plan") return;
    setState({
      kind: "plan",
      messageId: message.id,
      content: message.content,
      title: "Plan",
    });
  }, [setState]);
  const openDraftPlan = useCallback((plan: DraftPlanProjection) => {
    setState({
      kind: "plan",
      messageId: plan.itemId,
      planItemId: plan.itemId,
      content: plan.content,
      title: plan.editing ? "Editing" : "Plan",
    });
  }, [setState]);
  const reconcileRichValue = useCallback((value: RichValue) => {
    setState((current) =>
      (current.kind === "file" || current.kind === "workspace-preview") &&
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

  const openWorkspaceFile = useCallback(
    async (node: Extract<RichNode, { type: "workspace-file" }>) => {
      if (node.entryKind === "dir") return;
      const generation = ++workspaceGeneration.current;
      setState({
        kind: "workspace-preview",
        nodeId: node.id,
        filename: node.path,
        status: "loading",
      });
      try {
        const readRef = await resignWorkspaceFile({
          scope: workspaceScope,
          path: node.path,
          entryKind: "file",
        });
        const result = await readWorkspaceFile({ scope: workspaceScope, readRef });
        setState((current) => {
          if (
            current.kind !== "workspace-preview" ||
            current.nodeId !== node.id ||
            generation !== workspaceGeneration.current
          ) return current;
          if (result.kind === "text") {
            return { ...current, status: "text", content: result.content };
          }
          if (result.kind === "metadata") {
            return {
              ...current,
              status: "metadata",
              size: result.size,
              mtimeMs: result.mtimeMs,
              reason: result.reason,
            };
          }
          return {
            ...current,
            status: "metadata",
            size: result.size,
            mtimeMs: result.mtimeMs,
            reason: "binary",
          };
        });
      } catch (cause) {
        setState((current) =>
          current.kind === "workspace-preview" &&
          current.nodeId === node.id &&
          generation === workspaceGeneration.current
            ? { ...current, status: "error", error: errorMessage(cause) }
            : current
        );
      }
    },
    [setState, workspaceScope]
  );

  return useMemo(() => ({
    state,
    close,
    closeFile,
    openTabs,
    openDraftPlan,
    openFile,
    openWorkspaceFile,
    openImage,
    openPlan,
    openSubagent,
    reconcileRichValue,
  }), [
    close,
    closeFile,
    openDraftPlan,
    openFile,
    openImage,
    openPlan,
    openSubagent,
    openTabs,
    openWorkspaceFile,
    reconcileRichValue,
    state,
  ]);
}
