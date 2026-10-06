"use client";

/**
 * [INPUT]: Depends on router, Projects/Chats/Setup providers, Project Tools/MCP controllers, shared support projection, Project sections, persistent SettingsPage, tab-motion primitives, and i18n
 * [OUTPUT]: Provides full-width Project Settings with a persistent heading, animated primary navigation, lazily retained panels, nested Skills/Extensions settings, and exact-Project Tool scope ports
 * [POS]: apps/desktop/src/views/project; The sole `/projects/:projectId/settings` route; keeps the application Sidebar in Library context
 */

import { workbenchUiEnabled } from "@ai-chat/ui/lib/workbench-flag";
import { useOptionalWorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";

import { SettingsPage } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { useChats } from "@/components/providers/chats-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { ProjectGeneralSection } from "@/components/settings/project/project-general-section";
import { ProjectInstructionsSection } from "@/components/settings/project/project-instructions-section";
import { ProjectSkillsSettings } from "@/components/settings/project/skills/settings";
import {
  BuiltinToolsSection,
  type BuiltinToolsSectionPort,
} from "@/components/settings/tools/builtin-tools-section";
import {
  McpServersSection,
  useMcpServersPort,
  type McpServersSectionPort,
} from "@/components/settings/tools/mcp-servers-section";
import { SettingsCanvas } from "@/components/settings/settings-layout";
import { draftRoute, projectAlive } from "@/lib/chat/drafts/draft-route";
import { createProjectToolsController } from "@/lib/projects/project-tools-client";
import { PROJECT_TOOLS_BRIDGE_UNAVAILABLE } from "../../../shared/ipc/workspace/project-tools-ipc";
import type { Project } from "../../../shared/ipc/workspace/projects-ipc";
import {
  projectEffectiveState,
  resolveBuiltinBackendSupportMatrix,
} from "../../../shared/tools/tool-support";
import {
  Tabs,
  TabsTrigger,
} from "@ai-chat/ui/components/ui/tabs";
import { AnimatedTabsList, RetainedTabsContent } from "@ai-chat/ui/components/ui/navigation/tabs-motion";

/* Workflows sits after General (Q28) and exists only in builds with the workbench flag. */
const PROJECT_TABS = [
  "general",
  ...(workbenchUiEnabled ? ["workflows" as const] : []),
  "personalization",
  "skills",
  "tools",
] as const;
type ProjectTab = (typeof PROJECT_TABS)[number] | "workflows";

import { useDeferredModule } from "@ai-chat/ui/hooks/use-deferred-module";
import { DeferredStatus } from "@/components/deferred/status";
const loadWorkflows = () => import("@/components/settings/project/workflows/project-workflows-section");
function DeferredWorkflows({ project }: { project: Project }) {
  const module = useDeferredModule(loadWorkflows), Section = module.value?.ProjectWorkflowsSection;
  return Section ? <Section project={project} /> : <DeferredStatus failed={module.failed} retry={module.retry} reloadRequired={module.reloadRequired} />;
}
const ProjectWorkflowsSection = workbenchUiEnabled ? DeferredWorkflows : null;

const validTab = (value: string | null): ProjectTab =>
  value === "extensions" ? "skills"
    : PROJECT_TABS.includes(value as ProjectTab) ? value as ProjectTab : "general";

export function ProjectSettingsView() {
  const { t, i18n } = useAppTranslation();
  const workbench = useOptionalWorkbenchCopy(i18n.language);
  const { projectId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projects, loading } = useProjects();
  const { chats } = useChats();
  const project = projects.find((candidate) => candidate.id === projectId);
  const tab = validTab(searchParams.get("tab"));

  if (loading) {
    return (
      <SettingsPage width="full" title={<span aria-hidden className="inline-block h-4 w-40 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />}>
        <SettingsCanvas><div className="h-20 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" /></SettingsCanvas>
      </SettingsPage>
    );
  }
  if (!project || !projectAlive(project)) return <Navigate to="/" replace />;

  const projectChats = chats.filter(
    (chat) => chat.projectId === project.id && !chat.effectiveArchived
  );
  // Navigation stays outside panel lifetimes and nested tab contexts.
  return (
    <Tabs
      key={project.id}
      className="flex h-full min-h-0 flex-col gap-0"
      value={tab}
      onValueChange={(value) => setSearchParams({ tab: value }, { replace: false })}
    >
      <SettingsPage
        width="full"
        headingPlacement="page"
        backHref={draftRoute(project.id)}
        rail={
          <div className="mx-3 overflow-x-auto">
            <AnimatedTabsList value={tab} className="flex w-max min-w-full justify-start border-b border-border group-data-horizontal/tabs:h-10">
              {PROJECT_TABS.map((value) => (
                <TabsTrigger className="flex-none cursor-pointer px-3" key={value} value={value}>
                  {value === "workflows" && workbench ? workbench.projectWorkflows.tab : t(`projectSettings.tabs.${value}`)}
                </TabsTrigger>
              ))}
            </AnimatedTabsList>
          </div>
        }
        title={t("projectSettings.title", { name: project.name })}
      >
        <RetainedTabsContent className="h-full" value="general" active={tab === "general"}>
          <ProjectGeneralSection key={project.id} chats={projectChats} project={project} />
        </RetainedTabsContent>
        {ProjectWorkflowsSection && (
          <RetainedTabsContent className="h-full" value="workflows" active={tab === "workflows"}>
            <ProjectWorkflowsSection key={project.id} project={project} />
          </RetainedTabsContent>
        )}
        <RetainedTabsContent className="h-full" value="personalization" active={tab === "personalization"}>
          <ProjectInstructionsSection key={project.id} project={project} />
        </RetainedTabsContent>
        <RetainedTabsContent className="h-full" value="skills" active={tab === "skills"}>
          <ProjectSkillsSettings key={project.id} project={project} />
        </RetainedTabsContent>
        <RetainedTabsContent className="h-full" value="tools" active={tab === "tools"}>
          <ProjectToolsSettings key={project.id} project={project} />
        </RetainedTabsContent>
      </SettingsPage>
    </Tabs>
  );
}

function ProjectToolsSettings({ project }: { project: Project }) {
  const { t } = useAppTranslation();
  const setup = useSetup();
  const toolsController = useMemo(
    () => createProjectToolsController(project.id),
    [project.id]
  );
  const mcpScope = useMemo(
    () => ({ kind: "project" as const, projectId: project.id }),
    [project.id]
  );
  const {
    controller: mcpController,
    backendFacts,
    port: mcpBase,
  } = useMcpServersPort(mcpScope);
  const tools = useSyncExternalStore(
    toolsController.subscribe,
    toolsController.getSnapshot
  );

  useEffect(() => {
    void toolsController.load();
  }, [toolsController]);

  const policy = tools.value?.policy;
  const hasBuiltinOverrides = Boolean(
    policy && Object.keys(policy.builtinOverrides).length
  );
  const hasMcpOverrides = Boolean(
    policy && Object.keys(policy.globalMcpOverrides).length
  );
  const toolsError =
    tools.error === PROJECT_TOOLS_BRIDGE_UNAVAILABLE
      ? t("projectSettings.tools.bridgeMissing")
      : tools.error;
  const builtinPort = useMemo<BuiltinToolsSectionPort>(() => ({
    kind: "project",
    ready: Boolean(tools.value && setup.status),
    error: toolsError,
    tools: (tools.value?.builtinTools ?? []).map((tool) => {
      const backendSupport = resolveBuiltinBackendSupportMatrix(
        tool.toolId,
        backendFacts
      );
      return {
        toolId: tool.toolId,
        intentEnabled: tool.intentEnabled,
        effectiveState: projectEffectiveState(
          tool.intentEnabled,
          backendSupport
        ),
        source: tool.source,
        override: tool.override,
        backendSupport,
      };
    }),
    hasOverrides: hasBuiltinOverrides || hasMcpOverrides,
    setEnabled: (toolId, enabled) =>
      toolsController.setBuiltinOverride(
        toolId,
        enabled ? "enabled" : "disabled"
      ),
    resetTool: toolsController.resetBuiltinOverride,
    resetAll: async () => {
      const changed = await toolsController.resetAll();
      if (changed) await mcpController.load();
      return changed;
    },
  }), [
    hasBuiltinOverrides,
    hasMcpOverrides,
    backendFacts,
    mcpController,
    tools.value,
    toolsController,
    toolsError,
    setup.status,
  ]);
  const mcpPort = useMemo<McpServersSectionPort>(() => ({
    kind: "project",
    ...mcpBase,
    pending: new Set([...mcpBase.pending, ...tools.pending]),
    hasPolicyOverrides: hasMcpOverrides,
    setInheritedEnabled: async (serverId, enabled) => {
      const changed = await toolsController.setGlobalMcpOverride(
        serverId,
        enabled ? "enabled" : "disabled"
      );
      if (changed) await mcpController.load();
      return changed;
    },
    resetInherited: async (serverId) => {
      const changed = await toolsController.resetGlobalMcpOverride(serverId);
      if (changed) await mcpController.load();
      return changed;
    },
  }), [hasMcpOverrides, mcpBase, mcpController, tools.pending, toolsController]);

  return (
    <SettingsCanvas>
      <div className="space-y-8">
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t("projectSettings.tools.scopeNote", { name: project.name })}
        </p>
        <BuiltinToolsSection port={builtinPort} />
        <McpServersSection port={mcpPort} />
      </div>
    </SettingsCanvas>
  );
}
