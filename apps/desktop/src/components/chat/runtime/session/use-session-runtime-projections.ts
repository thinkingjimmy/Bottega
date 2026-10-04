/**
 * [INPUT]: Depends on Setup/chat providers, trusted window role, chat projection stores, workspace identity, Skills/files hooks, and canonical turn snapshots
 * [OUTPUT]: Starts model catalogs as soon as canonical Agent options resolve, keeps Skills/files session-gated, and synchronizes main-owned chat message projections generation-safely
 * [POS]: Session submodule projection adapter; keeps external catalog/message subscriptions out of the ChatSession composition root
 */

import { recentTurns } from "@/lib/native-transcript/window";
import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { builtinAgent } from "../../../../../shared/chat-agent/options";
import type { AgentBackendId, AgentScope, AgentWorkspaceScope } from "../../../../../shared/ipc/agent/agent-ipc";
import type { ChatMessage } from "../../../../../shared/ipc/content/chats-ipc";
import type { ProjectWorkspaceBinding } from "../../../../../shared/ipc/workspace/projects-ipc";
import { useSetup } from "@/components/providers/setup-provider";
import { backendAvailability } from "@/lib/chat/state/chat-hydration";
import { mergeChatMessages, type ChatTurnProjection } from "@/lib/chat/session/chat-turn-attach";
import type { LocalPlatform } from "@/lib/cloud/chat/platform/local";
import { primeComposer } from "@/lib/chat/state/composer/chat-composer-store";
import { useChatSettings } from "../settings/use-chat-settings";
import { useChatSkills } from "../settings/use-chat-skills";
import { useWorkspaceFiles } from "../files/use-workspace-files";
import { windowContext } from "@/lib/platform/window-surfaces-client";

export function useSessionRuntimeCatalogs({
  scope,
  sessionReady,
  workspaceScope,
  workspaceScopeKey,
  workspaceBinding,
  draftAgent,
}: {
  scope: AgentScope;
  sessionReady: boolean;
  workspaceScope: AgentWorkspaceScope;
  workspaceScopeKey: string;
  workspaceBinding?: ProjectWorkspaceBinding | null;
  draftAgent?: AgentBackendId;
}) {
  const setup = useSetup();
  const settings = useChatSettings(
    scope,
    workspaceScope,
    setup.status?.backends ?? [],
    setup.recheck,
    draftAgent,
    workspaceScopeKey,
    workspaceBinding ?? null
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
    backend: builtinAgent(settings.turnOptions.backend),
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
  platform,
}: {
  platform: LocalPlatform;
  chatId: string;
  hydratedChatId: string | null;
  projectionRef: MutableRefObject<ChatTurnProjection>;
  messagesRef: MutableRefObject<ChatMessage[]>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}) {
  const snapshot = platform.transcript.useSnapshot(chatId);
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
      // S4d step 3: the projection keeps the last two turns and local rows; history lives in the transcript window.
      messages: recentTurns(replace
        ? snapshot.messages
        : mergeChatMessages(projectionRef.current.messages, snapshot.messages)),
    };
    messagesRef.current = projectionRef.current.messages;
    setMessages(messagesRef.current);
  }, [chatId, hydratedChatId, messagesRef, projectionRef, setMessages, snapshot]);
  return snapshot;
}
