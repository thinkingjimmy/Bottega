/**
 * [INPUT]: Depends on AgentWorkspaceScope, canonical TurnProjectContext, Project lifecycle/binding authority, role-aware App data custody, and Chats
 * [OUTPUT]: Provides strict scope validation, role-aware effective workspace plus Project incarnation context, and conversation context resolution
 * [POS]: Electron main's workspace and turn-Project authority; filesystem and scoped resource consumers share one canonical decision
 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import type { AgentWorkspaceScope } from "../../shared/agent-ipc";
import {
  PROJECT_UNAVAILABLE,
  type ProjectWorkspaceBinding,
} from "../../shared/projects-ipc";
import type { WorkspaceResolver } from "./skills-catalog";
import type { TurnProjectContext } from "../../shared/product-resource-scope";

type AppSource = {
  resolveApp: (appId: string) => { dir: string } | undefined;
  resolveAppData?: (appId: string) =>
    | {
        workspace: string;
        authorityIdentity: string;
        stableWorkspaceOwnerId: string;
        dataCustodyId: string;
      }
    | null
    | undefined;
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
  getProjectLifecycleRevision?: (projectId: string) => number | undefined;
};

type ChatSource = {
  has: (conversationId: string) => boolean;
  getProjectId: (conversationId: string) => string | null | undefined;
  getHomeDir?: (conversationId: string) => string | undefined;
  getExecutionDir?: (conversationId: string) => string | undefined;
  getAppRole?: (conversationId: string) => "edit" | "use" | null | undefined;
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type WorkspaceOwner =
  | {
      kind: "project";
      projectId: string;
      membershipRevision: number;
      bindingCustodyId: string;
    }
  | { kind: "app"; appId: string }
  | { kind: "app-data"; appId: string; dataCustodyId: string }
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
      /** Mutable fence identity used by leases and CAS. */
      authorityIdentity: string;
      /** Durable data identity used by CanvasRegistry and VersionHistory. */
      stableWorkspaceOwnerId: string;
      /** Compatibility alias for existing consumers; always equals authorityIdentity. */
      identity: string;
      projectContext: TurnProjectContext;
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
  apps: AppSource,
  projects: ProjectSource,
  conversation?: { id: string; homeDir: string; appRole?: "edit" | "use" | null }
): EffectiveWorkspace {
  const revision = projects.getMembershipRevision?.(projectId);
  const projectLifecycleRevision =
    projects.getProjectLifecycleRevision?.(projectId);
  const binding = projects.getWorkspaceBinding?.(projectId);
  if (projects.getMembershipRevision && revision === undefined) {
    return unavailable(
      "project-missing",
      `${PROJECT_UNAVAILABLE}: Project 记录不存在`
    );
  }
  if (
    projects.getProjectLifecycleRevision &&
    projectLifecycleRevision === undefined
  ) {
    return unavailable(
      "project-missing",
      `${PROJECT_UNAVAILABLE}: Project lifecycle 记录不存在`
    );
  }
  const projectContext = {
    projectId,
    projectLifecycleRevision: projectLifecycleRevision ?? 1,
  } as const;
  if (binding?.kind === "none" && !conversation) {
    return unavailable(
      "project-unbound",
      `${PROJECT_UNAVAILABLE}: Project 未绑定工作目录`
    );
  }
  try {
    if (binding?.kind === "app" && conversation?.appRole === "use") {
      const data = apps.resolveAppData?.(binding.appId);
      if (data === null) {
        return unavailable("app-unavailable", "App 数据域尚未就绪");
      }
      if (data) {
        const membershipRevision = revision ?? 0;
        const authorityIdentity = `${data.authorityIdentity}:project:${projectId}:${membershipRevision}`;
        return {
          kind: "ready",
          workspace: data.workspace,
          owner: {
            kind: "app-data",
            appId: binding.appId,
            dataCustodyId: data.dataCustodyId,
          },
          authorityIdentity,
          stableWorkspaceOwnerId: data.stableWorkspaceOwnerId,
          identity: authorityIdentity,
          projectContext,
        };
      }
    }
    const resolved =
      !conversation
        ? projects.resolveCodexContext(projectId)
        : projects.resolveConversationContext?.(
            projectId,
            conversation.homeDir
          ) ??
          projects.resolveCodexContext(projectId);
    if (binding?.kind === "none" && conversation) {
      const authorityIdentity = `chat-home:${conversation.id}`;
      return {
        kind: "ready",
        workspace: resolved.workspace,
        owner: { kind: "chat-home", conversationId: conversation.id },
        authorityIdentity,
        stableWorkspaceOwnerId: authorityIdentity,
        identity: authorityIdentity,
        projectContext,
      };
    }
    const membershipRevision = revision ?? 0;
    if (binding?.kind === "app") {
      const authorityIdentity = `project:${projectId}:${membershipRevision}`;
      return {
        kind: "ready",
        workspace: resolved.workspace,
        owner: { kind: "app", appId: binding.appId },
        authorityIdentity,
        stableWorkspaceOwnerId: `app-source:${binding.appId}`,
        identity: authorityIdentity,
        projectContext,
      };
    }
    const bindingCustodyId =
      binding?.kind === "external"
        ? binding.capabilityId
        : `legacy-${projectId}`;
    const authorityIdentity = `project:${projectId}:${membershipRevision}`;
    return {
      kind: "ready",
      workspace: resolved.workspace,
      owner: {
        kind: "project",
        projectId,
        membershipRevision,
        bindingCustodyId,
      },
      authorityIdentity,
      stableWorkspaceOwnerId: `project-binding:${projectId}:${bindingCustodyId}`,
      identity: authorityIdentity,
      projectContext,
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
    const authorityIdentity = "default";
    return {
      kind: "ready",
      workspace: defaultWorkspace,
      owner: { kind: "default" },
      authorityIdentity,
      stableWorkspaceOwnerId: authorityIdentity,
      identity: authorityIdentity,
      projectContext: { projectId: null, projectLifecycleRevision: null },
    };
  }
  if (scope.kind === "project") {
    return resolveProject(scope.projectId, apps, projects);
  }
  if (scope.kind === "app") {
    const resolved = apps.resolveApp(scope.appId);
    const authorityIdentity = `app:${scope.appId}`;
    return resolved
      ? {
          kind: "ready",
          workspace: resolved.dir,
          owner: { kind: "app", appId: scope.appId },
          authorityIdentity,
          stableWorkspaceOwnerId: `app-source:${scope.appId}`,
          identity: authorityIdentity,
          projectContext: { projectId: null, projectLifecycleRevision: null },
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
    const authorityIdentity = `chat-home:${scope.conversationId}`;
    return {
      kind: "ready",
      workspace: homeDir,
      owner: { kind: "chat-home", conversationId: scope.conversationId },
      authorityIdentity,
      stableWorkspaceOwnerId: authorityIdentity,
      identity: authorityIdentity,
      projectContext: { projectId: null, projectLifecycleRevision: null },
    };
  }
  const project = resolveProject(projectId, apps, projects, {
    id: scope.conversationId,
    homeDir,
    appRole: chats.getAppRole?.(scope.conversationId),
  });
  if (
    project.kind !== "ready" ||
    !executionDir ||
    project.owner.kind === "app-data" ||
    executionDir === project.workspace
  ) {
    return project;
  }
  // executionDir 覆写指向与 Project 工作目录不同的物理目录时，必须把这一差异
  // 折叠进 stableWorkspaceOwnerId：否则同一 Project 下两个 originalCwd 不同的
  // chat 会塌缩成同一 artboard 身份，restore 时互相覆盖对方的 design/ 文件。
  // authorityIdentity（可变 fence）保持不变。
  return {
    ...project,
    workspace: executionDir,
    stableWorkspaceOwnerId: `${project.stableWorkspaceOwnerId}:exec:${executionOwnerSegment(executionDir)}`,
  };
}

function executionOwnerSegment(executionDir: string) {
  return createHash("sha256").update(executionDir).digest("hex").slice(0, 16);
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
    if (result.kind === "ready") {
      return {
        workspace: result.workspace,
        projectContext: result.projectContext,
      };
    }
    /* Project Settings still needs main-owned Library/Extension visibility for a
       grouping Project. A private, nonexistent catalog root suppresses only
       workspace discovery; canonical Project identity and lifecycle remain real.
       Other consumers keep using EffectiveWorkspace and therefore still see the
       grouping Project as filesystem-unavailable. */
    if (
      result.reason === "project-unbound" &&
      scope.kind === "project" &&
      projects &&
      defaultWorkspace
    ) {
      const projectLifecycleRevision =
        projects.getProjectLifecycleRevision?.(scope.projectId);
      if (!projectLifecycleRevision) throw new Error(result.message);
      return {
        workspace: join(
          defaultWorkspace,
          ".grouped-project-scope",
          scope.projectId
        ),
        projectContext: {
          projectId: scope.projectId,
          projectLifecycleRevision,
        },
      };
    }
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
        projectContext: {
          projectId,
          projectLifecycleRevision: requireProjectLifecycleRevision(
            projects,
            projectId
          ),
        },
      }
    : {
        workspace: homeDir,
        projectContext: { projectId: null, projectLifecycleRevision: null },
      };
}

function requireProjectLifecycleRevision(
  projects: ProjectSource,
  projectId: string
) {
  const revision = projects.getProjectLifecycleRevision?.(projectId);
  if (projects.getProjectLifecycleRevision && revision === undefined) {
    throw new Error(`${PROJECT_UNAVAILABLE}: Project lifecycle 记录不存在`);
  }
  return revision ?? 1;
}
