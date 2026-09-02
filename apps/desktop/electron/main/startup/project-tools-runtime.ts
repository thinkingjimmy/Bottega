/**
 * [INPUT]: Depends on canonical Project/Chat stores, Settings defaults, backend runtime facts, Project Tool/MCP stores, lifecycle cleanup, and Skills workspace invalidation
 * [OUTPUT]: Provides Project Tools store composition, resolver/Skills policy wiring, targeted invalidation, and exact-owner cleanup participant registration
 * [POS]: Startup composition seam for Project-scoped Tools; keeps persistence, Skills, and deletion wiring out of the Electron lifecycle root
 */

import { BUILTIN_TOOL_NAMES } from "../../../shared/builtin-tools";
import type { SkillsCatalog, SkillsCatalogDependencies } from "../skills-catalog";
import { backendRuntimeRegistry } from "../backends";
import type { ChatStore } from "../chats/chat-store";
import type { ProjectStore } from "../projects/store/project-store";
import {
  PROJECT_CLEANUP_PLAN,
  ProjectResourceCleanupCoordinator,
} from "../projects/resource-cleanup/coordinator";
import { canonicalHash } from "../sections/coordinator/coordinator-values";
import type { SettingsStore } from "../settings-store";
import { ManualMcpServersStore } from "../tools/mcp/store";
import { ProjectToolsResolver } from "../tools/project/resolver";
import { ProjectToolPolicyStore } from "../tools/project/store";

function createResolver(input: Readonly<{
  projects: ProjectStore;
  policies: ProjectToolPolicyStore;
  manualMcpServers: ManualMcpServersStore;
  settings: SettingsStore;
}>) {
  return new ProjectToolsResolver(
    input.projects,
    input.policies,
    input.manualMcpServers,
    BUILTIN_TOOL_NAMES.filter((name) => name !== "use_skill"),
    () => {
      const disabled = new Set(input.settings.get().disabledBuiltinTools);
      return {
        revision: input.settings.envelope().revision,
        disabledTools: BUILTIN_TOOL_NAMES.filter((name) => disabled.has(name)),
      };
    }
  );
}

function createSkillsToolPolicyResolver(input: Readonly<{
  projects: ProjectStore;
  chats: ChatStore;
  tools: ProjectToolsResolver;
}>): NonNullable<SkillsCatalogDependencies["toolPolicyForScope"]> {
  return async ({ scope, workspace, backend, planMode }) => {
    const projectId = scope.kind === "project"
      ? scope.projectId
      : scope.kind === "conversation"
        ? input.chats.getProjectId(scope.conversationId) ?? null
        : scope.kind === "app"
          ? input.projects.findByAppId(scope.appId)?.id ?? null
          : null;
    if (scope.kind === "app" && projectId === null) {
      throw new Error("App Project 不存在，无法解析 Skill 工具策略");
    }
    const runtime = await backendRuntimeRegistry.resolve(backend);
    const snapshot = input.tools.resolve({
      projectId,
      workspace,
      backend,
      builtinTools: runtime.runtimeStatus === "installed"
        ? runtime.capabilities.builtinTools
        : "none",
      planMode,
    });
    return {
      allowedTools: snapshot.allowedTools,
      policyDigest: canonicalHash({
        projectContext: snapshot.projectContext,
        resourceVersion: snapshot.resourceVersion,
        policyRevisions: snapshot.policyRevisions,
        builtinIntent: snapshot.builtinIntent,
        allowedTools: snapshot.allowedTools,
      }),
    };
  };
}

function subscribeProjectToolSkillInvalidation(input: Readonly<{
  projects: ProjectStore;
  policies: ProjectToolPolicyStore;
  invalidateWorkspace(workspace: string): void;
}>) {
  return input.policies.onChanged(({ projectId }) => {
    const project = input.projects.get(projectId);
    if (!project || input.projects.isDeleting(projectId)) return;
    const workspace =
      input.projects.resolveWorkspace(project.workspaceBinding) ?? project.dir;
    if (workspace) input.invalidateWorkspace(workspace);
  });
}

export class ProjectToolsRuntime {
  readonly manualMcpServers: ManualMcpServersStore;
  readonly policies: ProjectToolPolicyStore;
  readonly resourceCleanup: ProjectResourceCleanupCoordinator;
  private resolved: ProjectToolsResolver | null = null;

  private constructor(
    readonly projects: ProjectStore,
    userData: string
  ) {
    this.manualMcpServers = new ManualMcpServersStore(userData);
    this.policies = new ProjectToolPolicyStore(userData, {
      globalMcpServerExists: (serverId) =>
        this.manualMcpServers.owned({ kind: "global" }).some(
          (server) => server.serverId === serverId
        ),
    });
    this.resourceCleanup = new ProjectResourceCleanupCoordinator(
      projects,
      PROJECT_CLEANUP_PLAN
    );
    this.resourceCleanup.register({
      id: "tools",
      cleanup: async ({ projectId }) => {
        await this.policies.cleanupProject(projectId);
        await this.manualMcpServers.cleanupProject(projectId);
      },
    });
  }

  static async create(userData: string, projects: ProjectStore) {
    const runtime = new ProjectToolsRuntime(projects, userData);
    await runtime.manualMcpServers.initialize();
    return runtime;
  }

  async initialize(settings: SettingsStore) {
    await this.policies.initialize();
    this.resolved = createResolver({
      projects: this.projects,
      policies: this.policies,
      manualMcpServers: this.manualMcpServers,
      settings,
    });
  }

  get resolver() {
    if (!this.resolved) throw new Error("Project Tools runtime 尚未初始化");
    return this.resolved;
  }

  skillPolicy(chats: ChatStore) {
    return createSkillsToolPolicyResolver({
      projects: this.projects,
      chats,
      tools: this.resolver,
    });
  }

  connectSkills(catalog: SkillsCatalog) {
    return subscribeProjectToolSkillInvalidation({
      projects: this.projects,
      policies: this.policies,
      invalidateWorkspace: (workspace) => catalog.invalidateWorkspace(workspace),
    });
  }

  async closeAndFlush() {
    await this.policies.closeAndFlush();
    await this.manualMcpServers.closeAndFlush();
  }
}
