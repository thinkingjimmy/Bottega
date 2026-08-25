/**
 * [INPUT]: Depends on React memo, Chat/Project abstract, chat-hydration scope rules and session project mode
 * [OUTPUT]: Provides useWorkspaceLifecycle, separates wire scope, canonical Workspace precondition, async fence key and durable draft identity
 * [POS]: The Workspace lifecycle projector for chat/runtime; use-chat-session only sort out side effects and no longer type as JSON
 */

import { useMemo } from "react";
import type { ChatSummary } from "../../../../shared/chats-ipc";
import type { Project } from "../../../../shared/projects-ipc";
import {
  chatWorkspaceScope,
  type DraftWorkspaceScope,
} from "@/lib/chat-hydration";
import {
  workspacePreconditionFor,
  type ChatProjectMode,
} from "./chat-session-model";

export function useWorkspaceLifecycle({
  chatId,
  chats,
  composerIncarnationId,
  messageIncarnationId,
  persisted,
  project,
  projects,
  selectedProjectId,
}: {
  chatId: string;
  chats: readonly ChatSummary[];
  composerIncarnationId: string;
  messageIncarnationId?: string;
  persisted: boolean;
  project: ChatProjectMode;
  projects: readonly Project[];
  selectedProjectId: string | null;
}) {
  const fixedAppId = project.kind === "fixed-app" ? project.appId : null;
  const draftScope = useMemo<DraftWorkspaceScope>(() => {
    if (fixedAppId) return { kind: "app", appId: fixedAppId };
    if (selectedProjectId) {
      return { kind: "project", projectId: selectedProjectId };
    }
    return { kind: "default" };
  }, [fixedAppId, selectedProjectId]);
  const persistedProjectId = chats.find((chat) => chat.id === chatId)?.projectId;
  const projectId = persisted
    ? persistedProjectId
    : selectedProjectId ??
      (fixedAppId
        ? projects.find(
            (candidate) =>
              candidate.workspaceBinding.kind === "app" &&
              candidate.workspaceBinding.appId === fixedAppId
          )?.id
        : null);
  const lifecycleProject = projects.find((candidate) => candidate.id === projectId);
  const incarnationId = persisted
    ? messageIncarnationId || composerIncarnationId || null
    : null;

  return useMemo(() => {
    const workspaceScope = chatWorkspaceScope(chatId, persisted, draftScope);
    const identity = {
      scope: workspaceScope,
      projectId: projectId ?? null,
      membershipRevision: lifecycleProject?.membershipRevision ?? null,
      workspaceBinding: lifecycleProject?.workspaceBinding ?? null,
    };
    return {
      workspaceScope,
      workspacePrecondition: workspacePreconditionFor(
        workspaceScope,
        lifecycleProject,
        incarnationId
      ),
      workspaceIdentityKey: JSON.stringify(identity),
      workspaceScopeKey: JSON.stringify({ ...identity, incarnationId }),
    };
  }, [
    chatId,
    draftScope,
    incarnationId,
    lifecycleProject,
    persisted,
    projectId,
  ]);
}
