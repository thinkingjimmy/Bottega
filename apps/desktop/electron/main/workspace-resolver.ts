/**
 * [INPUT]: Depends on shared AgentWorkspaceScope/ProjectWorkspaceBinding with Apps/Projects/Chats ((including adopted original cwd))
 * [OUTPUT]: Provides a strict scope test, resolveEffectiveWorkspace and resolveConversationContext; Adoption resume using the external source cwd after Project Fence
 * [POS]: Electron main's workspace is the only decision-making core; File candidates, Chat Home, Project binding, Skill and turn share the same fact of the solving
 */

import type { AgentWorkspaceScope } from "../../shared/agent-ipc";
import {
  PROJECT_UNAVAILABLE,
  type ProjectWorkspaceBinding,
} from "../../shared/projects-ipc";
import type { WorkspaceResolver } from "./skills-catalog";

type AppSource = {
  resolveApp: (appId: string) => { dir: string } | undefined;
};

type ProjectSource = {
  resolveCodexContext: (projectId: string) => { workspace: string };
  resolveConversationContext?: (
    projectId: string,
    homeDir: string
  ) => { workspace: string };
  getWorkspaceBinding?: (
    projectId: string
  ) => ProjectWorkspaceBinding | undefined;
  getMembershipRevision?: (projectId: string) => number | undefined;
};

type ChatSource = {
  has: (conversationId: string) => boolean;
  getProjectId: (conversationId: string) => string | null | undefined;
  getHomeDir?: (conversationId: string) => string | undefined;
  getExecutionDir?: (conversationId: string) => string | undefined;
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type WorkspaceOwner =
  | { kind: "project"; projectId: string; membershipRevision: number }
  | { kind: "app"; appId: string }
  | { kind: "chat-home"; conversationId: string }
  | { kind: "default" };

export type EffectiveWorkspaceUnavailableReason =
  | "project-unbound"
  | "project-missing"
  | "app-unavailable"
  | "chat-missing";

export type EffectiveWorkspace =
  | {
      kind: "ready";
      workspace: string;
      owner: WorkspaceOwner;
      identity: string;
    }
  | {
      kind: "unavailable";
      reason: EffectiveWorkspaceUnavailableReason;
      message: string;
    };

export type EffectiveWorkspaceResolver = (
  scope: AgentWorkspaceScope
) => EffectiveWorkspace;

export function assertWorkspaceScope(value: unknown): AgentWorkspaceScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workspace scope 无效");
  }
  const scope = value as Partial<AgentWorkspaceScope> & { kind?: unknown };
  const keys = Object.keys(scope);
  if (scope.kind === "default" && keys.length === 1) return { kind: "default" };
  const id =
    scope.kind === "conversation"
      ? scope.conversationId
      : scope.kind === "project"
        ? scope.projectId
        : scope.kind === "app"
          ? scope.appId
          : undefined;
  if (keys.length !== 2 || typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new Error("Workspace scope 无效");
  }
  if (scope.kind === "conversation") {
    return { kind: "conversation", conversationId: id };
  }
  if (scope.kind === "project") return { kind: "project", projectId: id };
  if (scope.kind === "app") return { kind: "app", appId: id };
  throw new Error("Workspace scope 无效");
}

function unavailable(
  reason: EffectiveWorkspaceUnavailableReason,
  message: string
): EffectiveWorkspace {
  return { kind: "unavailable", reason, message };
}

function resolveProject(
  projectId: string,
  projects: ProjectSource,
  conversation?: { id: string; homeDir: string }
): EffectiveWorkspace {
  const revision = projects.getMembershipRevision?.(projectId);
  const binding = projects.getWorkspaceBinding?.(projectId);
  if (projects.getMembershipRevision && revision === undefined) {
    return unavailable(
      "project-missing",
      `${PROJECT_UNAVAILABLE}: Project 记录不存在`
    );
  }
  if (binding?.kind === "none" && !conversation) {
    return unavailable(
      "project-unbound",
      `${PROJECT_UNAVAILABLE}: Project 未绑定工作目录`
    );
  }
  try {
    const resolved =
      !conversation
        ? projects.resolveCodexContext(projectId)
        : projects.resolveConversationContext?.(
            projectId,
            conversation.homeDir
          ) ??
          projects.resolveCodexContext(projectId);
    if (binding?.kind === "none" && conversation) {
      return {
        kind: "ready",
        workspace: resolved.workspace,
        owner: { kind: "chat-home", conversationId: conversation.id },
        identity: `chat-home:${conversation.id}`,
      };
    }
    const membershipRevision = revision ?? 0;
    return {
      kind: "ready",
      workspace: resolved.workspace,
      owner: { kind: "project", projectId, membershipRevision },
      identity: `project:${projectId}:${membershipRevision}`,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return unavailable(
      binding?.kind === "app" ? "app-unavailable" : "project-missing",
      message
    );
  }
}

export function resolveEffectiveWorkspace(
  value: AgentWorkspaceScope,
  apps: AppSource,
  projects: ProjectSource,
  chats: ChatSource,
  defaultWorkspace: string
): EffectiveWorkspace {
  const scope = assertWorkspaceScope(value);
  if (scope.kind === "default") {
    return {
      kind: "ready",
      workspace: defaultWorkspace,
      owner: { kind: "default" },
      identity: "default",
    };
  }
  if (scope.kind === "project") {
    return resolveProject(scope.projectId, projects);
  }
  if (scope.kind === "app") {
    const resolved = apps.resolveApp(scope.appId);
    return resolved
      ? {
          kind: "ready",
          workspace: resolved.dir,
          owner: { kind: "app", appId: scope.appId },
          identity: `app:${scope.appId}`,
        }
      : unavailable("app-unavailable", "App 不可用（不存在或正在维护）");
  }
  if (!chats.has(scope.conversationId)) {
    return unavailable("chat-missing", "聊天不存在");
  }
  const homeDir = chats.getHomeDir?.(scope.conversationId) ?? defaultWorkspace;
  const executionDir = chats.getExecutionDir?.(scope.conversationId);
  const projectId = chats.getProjectId(scope.conversationId);
  if (!projectId) {
    return {
      kind: "ready",
      workspace: homeDir,
      owner: { kind: "chat-home", conversationId: scope.conversationId },
      identity: `chat-home:${scope.conversationId}`,
    };
  }
  const project = resolveProject(projectId, projects, {
    id: scope.conversationId,
    homeDir,
  });
  return project.kind === "ready" && executionDir
    ? { ...project, workspace: executionDir }
    : project;
}

export function createEffectiveWorkspaceResolver(
  apps: AppSource,
  projects: ProjectSource,
  chats: ChatSource,
  defaultWorkspace: string
): EffectiveWorkspaceResolver {
  return (scope) =>
    resolveEffectiveWorkspace(scope, apps, projects, chats, defaultWorkspace);
}

export function createWorkspaceResolver(
  apps: AppSource,
  projects: ProjectSource,
  chats: ChatSource,
  defaultWorkspace: string
): WorkspaceResolver;
export function createWorkspaceResolver(
  resolveEffective: EffectiveWorkspaceResolver
): WorkspaceResolver;
export function createWorkspaceResolver(
  appsOrResolver: AppSource | EffectiveWorkspaceResolver,
  projects?: ProjectSource,
  chats?: ChatSource,
  defaultWorkspace?: string
): WorkspaceResolver {
  const resolveEffective =
    typeof appsOrResolver === "function"
      ? appsOrResolver
      : createEffectiveWorkspaceResolver(
          appsOrResolver,
          projects!,
          chats!,
          defaultWorkspace!
        );
  return (scope) => {
    const result = resolveEffective(scope);
    if (result.kind === "ready") return { workspace: result.workspace };
    throw new Error(result.message);
  };
}

export function resolveConversationContext(
  conversationId: string,
  projects: ProjectSource,
  chats: ChatSource,
  draft?: { homeDir: string; projectId?: string | null }
) {
  const homeDir = draft?.homeDir ?? chats.getHomeDir?.(conversationId);
  if (!homeDir) throw new Error("聊天缺少有效 Chat Home");
  const projectId =
    draft?.projectId === undefined
      ? chats.getProjectId(conversationId)
      : draft.projectId;
  const executionDir = draft ? undefined : chats.getExecutionDir?.(conversationId);
  return projectId
    ? {
        ...(projects.resolveConversationContext?.(projectId, homeDir) ??
          projects.resolveCodexContext(projectId)),
        ...(executionDir ? { workspace: executionDir } : {}),
      }
    : { workspace: homeDir };
}
