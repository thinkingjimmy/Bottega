/**
 * [INPUT]: React memoization and the Agent scope and Project mode contracts.
 * [OUTPUT]: useSessionIdentity keeps scalar identity changes separate from transient host objects.
 * [POS]: Chat session identity projection; workspace and lifecycle ownership remain in the session.
 */
import { useMemo } from "react";
import type { AgentScope } from "../../../../../shared/ipc/agent/agent-ipc";
import type { AppChatRole } from "../../../../../shared/ipc/content/chats-ipc";
import type { ChatProjectMode } from "../chat-session-model";
export function useSessionIdentity(inputScope: AgentScope, inputProject: ChatProjectMode) {
  const chatId = inputScope.conversationId;
  const projectKind = inputProject.kind;
  const fixedAppId = projectKind === "fixed-app" ? inputProject.appId : null;
  const fixedAppRole: AppChatRole | null = projectKind === "fixed-app" ? inputProject.appRole : null;
  const scope = useMemo<AgentScope>(() => ({ conversationId: chatId }), [chatId]);
  const project = useMemo<ChatProjectMode>(
    () =>
      projectKind === "fixed-app"
        ? {
            kind: "fixed-app",
            appId: fixedAppId!,
            appRole: fixedAppRole!,
          }
        : { kind: "selectable" },
    [fixedAppId, fixedAppRole, projectKind]
  );
  return { chatId, projectKind, fixedAppId, fixedAppRole, scope, project };
}
