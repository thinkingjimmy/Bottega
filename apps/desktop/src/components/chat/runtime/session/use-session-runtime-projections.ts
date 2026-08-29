/**
 * [INPUT]: Depends on Setup/chat providers, trusted window role, chat projection stores, workspace identity, Skills/files hooks, and canonical turn snapshots
 * [OUTPUT]: Provides composer runtime catalogs, suppresses global Skills/workspace discovery in scoped App windows, and synchronizes main-owned chat message projections generation-safely
 * [POS]: Session submodule projection adapter; keeps external catalog/message subscriptions out of the ChatSession composition root
 */

import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { AgentBackendId, AgentScope, AgentWorkspaceScope } from "../../../../../shared/agent-ipc";
import type { ChatMessage } from "../../../../../shared/chats-ipc";
import { useSetup } from "@/components/providers/setup-provider";
import { backendAvailability } from "@/lib/chat-hydration";
import { mergeChatMessages, type ChatTurnProjection } from "@/lib/chat-turn-attach";
import { useChatMessages } from "@/lib/chat-messages-store";
import { primeComposer } from "@/lib/chat-composer-store";
import { useChatSettings } from "../use-chat-settings";
import { useChatSkills } from "../use-chat-skills";
import { useWorkspaceFiles } from "../use-workspace-files";
import { windowContext } from "@/lib/window-surfaces-client";

export function useSessionRuntimeCatalogs({
  scope,
  sessionReady,
  workspaceScope,
  workspaceScopeKey,
  draftAgent,
}: {
  scope: AgentScope;
  sessionReady: boolean;
  workspaceScope: AgentWorkspaceScope;
  workspaceScopeKey: string;
  draftAgent?: AgentBackendId;
}) {
  const setup = useSetup();
  const settings = useChatSettings(
    scope,
    sessionReady ? workspaceScope : null,
    setup.status?.backends ?? [],
    setup.recheck,
    draftAgent
  );
  const selectedBackend = settings.backends.find(
    (backend) => backend.id === settings.turnOptions.backend
  );
  const backendState = backendAvailability(selectedBackend, setup.checking);
  const planSupported = selectedBackend?.capabilities.planMode ?? false;
  const ready = sessionReady && selectedBackend?.runtimeStatus === "installed";
  const auxiliaryReady = ready && windowContext().role === "main";
  const skills = useChatSkills({
    ready: auxiliaryReady,
    workspaceScope,
    workspaceScopeKey,
    backend: settings.turnOptions.backend,
    planSupported,
  });
  const workspaceFileSearch = useWorkspaceFiles({
    ready: auxiliaryReady,
    workspaceScope,
    workspaceScopeKey,
    chatId: scope.conversationId,
  });
  return { setup, settings, selectedBackend, backendState, planSupported, skills, workspaceFileSearch };
}

export function useSessionMessageProjection({
  chatId,
  hydratedChatId,
  projectionRef,
  messagesRef,
  setMessages,
}: {
  chatId: string;
  hydratedChatId: string | null;
  projectionRef: MutableRefObject<ChatTurnProjection>;
  messagesRef: MutableRefObject<ChatMessage[]>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}) {
  const snapshot = useChatMessages(chatId);
  useEffect(() => {
    const incarnationId = snapshot?.incarnationId;
    if (incarnationId) primeComposer(chatId, incarnationId);
  }, [chatId, snapshot?.incarnationId]);
  const consumedReplaceRef = useRef("");
  useEffect(() => {
    if (!snapshot || hydratedChatId !== chatId) return;
    const replaceKey = `${chatId}:${snapshot.incarnationId}:${snapshot.revision}`;
    const replace = snapshot.mode === "replace" && consumedReplaceRef.current !== replaceKey;
    if (replace) consumedReplaceRef.current = replaceKey;
    projectionRef.current = {
      ...projectionRef.current,
      messages: replace
        ? snapshot.messages
        : mergeChatMessages(projectionRef.current.messages, snapshot.messages),
    };
    messagesRef.current = projectionRef.current.messages;
    setMessages(messagesRef.current);
  }, [chatId, hydratedChatId, messagesRef, projectionRef, setMessages, snapshot]);
  return snapshot;
}
