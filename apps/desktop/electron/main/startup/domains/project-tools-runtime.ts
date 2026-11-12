/**
 * [INPUT]: Depends on canonical Project and Chat stores, global Settings, MCP persistence, backend facts, and the Project cleanup coordinator
 * [OUTPUT]: Provides global tool resolution for turns and Skills, startup migration of retired Project tool settings, and Project cleanup registration
 * [POS]: Startup composition for global Tools. Project identity qualifies turns and deletion checkpoints
 */

import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { registeredToolNames } from "../../../../shared/plugin-tools";
import type { SkillsCatalogDependencies } from "../../skills/catalog/skills-catalog";
import { backendRuntimeRegistry } from "../../backends";
import type { ChatStore } from "../../chats/chat-store";
import type { ProjectStore } from "../../projects/store/project-store";
import { isErrnoCode, syncDirectory } from "../../persistence/durable-json";
import {
  PROJECT_CLEANUP_PLAN,
  ProjectResourceCleanupCoordinator,
} from "../../projects/resource-cleanup/coordinator";
import { canonicalHash } from "../../sections/coordinator/coordinator-values";
import type { SettingsStore } from "../../settings/settings-store";
import { ManualMcpServersStore } from "../../tools/mcp/store";
import { ProjectToolsResolver } from "../../tools/project/resolver";

function createResolver(input: Readonly<{
  projects: ProjectStore;
  manualMcpServers: ManualMcpServersStore;
  settings: SettingsStore;
}>) {
  return new ProjectToolsResolver(
    input.projects,
    input.manualMcpServers,
    () => {
      const disabled = new Set(input.settings.get().disabledBuiltinTools);
      return {
        revision: input.settings.envelope().revision,
        disabledTools: registeredToolNames().filter((name) => name !== "use_skill" && disabled.has(name)),
      };
    }
  );
}

function createSkillsToolPolicyResolver(input: Readonly<{
  projects: ProjectStore;
  chats: ChatStore;
  tools: ProjectToolsResolver;
}>): NonNullable<SkillsCatalogDependencies["toolPolicyForScope"]> {
  return async ({ scope, backend, planMode }) => {
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

async function removeRetiredToolPolicies(userData: string) {
  const removed = await Promise.all(
    ["project-tool-policies.json", "project-tool-policies.json.bak"].map(async (name) => {
      try {
        await unlink(join(userData, name));
        return true;
      } catch (cause) {
        if (isErrnoCode(cause, "ENOENT")) return false;
        throw cause;
      }
    })
  );
  if (removed.some(Boolean)) await syncDirectory(userData);
}

export class ProjectToolsRuntime {
  readonly manualMcpServers: ManualMcpServersStore;
  readonly resourceCleanup: ProjectResourceCleanupCoordinator;
  private resolved: ProjectToolsResolver | null = null;

  private constructor(
    readonly projects: ProjectStore,
    userData: string
  ) {
    this.manualMcpServers = new ManualMcpServersStore(userData);
    this.resourceCleanup = new ProjectResourceCleanupCoordinator(
      projects,
      PROJECT_CLEANUP_PLAN
    );
  }

  static async create(userData: string, projects: ProjectStore) {
    const runtime = new ProjectToolsRuntime(projects, userData);
    await runtime.manualMcpServers.initialize();
    await removeRetiredToolPolicies(userData);
    // An in-flight deletion can still require this participant after the startup migration.
    runtime.resourceCleanup.register({ id: "tools", cleanup: async () => {} });
    return runtime;
  }

  initialize(settings: SettingsStore) {
    this.resolved = createResolver({
      projects: this.projects,
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

  closeAndFlush() {
    return this.manualMcpServers.closeAndFlush();
  }
}
