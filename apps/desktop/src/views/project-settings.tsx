"use client";

/**
 * [INPUT]: Depends on router, canonical Projects/Chats/Setup providers, exact-Project Tools/MCP controllers, shared support projection, five Project tab sections, PageShell, and i18n
 * [OUTPUT]: Provides guarded Project Settings with five URL-backed tabs, exact-scope Skills and Extensions, and live-runtime-reprojected Project Tool scope ports that preserve global inheritance
 * [POS]: The sole `/projects/:projectId/settings` route; keeps the application Sidebar in Library context
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";
import { Settings } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { useChats } from "@/components/providers/chats-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { ProjectGeneralSection } from "@/components/settings/project/project-general-section";
import { ProjectInstructionsSection } from "@/components/settings/project/project-instructions-section";
import { ProjectSkillsSection } from "@/components/settings/project/project-skills-section";
import {
  BuiltinToolsSection,
  type BuiltinToolsSectionPort,
} from "@/components/settings/builtin-tools-section";
import {
  McpServersSection,
  type McpServersSectionPort,
} from "@/components/settings/mcp-servers-section";
import { SettingsCanvas } from "@/components/settings/settings-layout";
import { ExtensionsContent } from "@/views/settings-extensions";
import { draftRoute, projectAlive } from "@/lib/draft-route";
import {
  createProjectToolsController,
} from "@/lib/project-tools-client";
import { createMcpServersController } from "@/lib/mcp-servers-client";
import { PROJECT_TOOLS_BRIDGE_UNAVAILABLE } from "../../shared/project-tools-ipc";
import { MCP_SERVERS_BRIDGE_UNAVAILABLE } from "../../shared/mcp-servers-ipc";
import type { Project } from "../../shared/projects-ipc";
import {
  projectEffectiveState,
  projectManualMcpServerSupport,
  resolveBuiltinBackendSupportMatrix,
  toolBackendFacts,
} from "../../shared/tool-support";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ai-chat/ui/components/ui/tabs";

const PROJECT_TABS = [
  "general",
  "personalization",
  "skills",
  "extensions",
  "tools",
] as const;
type ProjectTab = (typeof PROJECT_TABS)[number];

const validTab = (value: string | null): ProjectTab =>
  PROJECT_TABS.includes(value as ProjectTab) ? value as ProjectTab : "general";

export function ProjectSettingsView() {
  const { t } = useAppTranslation();
  const { projectId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projects, loading } = useProjects();
  const { chats } = useChats();
  const project = projects.find((candidate) => candidate.id === projectId);
  const tab = validTab(searchParams.get("tab"));
  const extensionScope = useMemo(
    () => ({ kind: "project", projectId } as const),
    [projectId]
  );

  if (loading) {
    return (
      <PageShell title={<span aria-hidden className="inline-block h-4 w-40 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />}>
        <div className="h-full" />
      </PageShell>
    );
  }
  if (!project || !projectAlive(project)) return <Navigate to="/" replace />;

  const projectChats = chats.filter(
    (chat) => chat.projectId === project.id && !chat.effectiveArchived
  );
  /* Tabs 从页面主体升到最外层，只为一件事：页签条要交给 PageShell 当第二层
     页头。从前它是内容的第一个孩子，自带一条整幅分界线，于是页头一条、它
     一条，中间夹着 40px 空白说同一句「页头到此为止」。现在页头块只有最下沿
     那一条线，选中态的下划线正压在它上面——线与被选中的那一页从此是同一件
     东西。代价只是这一层嵌套，换来的是分界线不再有第二个作者。 */
  return (
    <Tabs
      className="flex h-full min-h-0 flex-col gap-0"
      value={tab}
      onValueChange={(value) => setSearchParams({ tab: value }, { replace: false })}
    >
      <PageShell
        backHref={draftRoute(project.id)}
        icon={<Settings />}
        rail={
          /* h-10 与页头等高：两行 40px 读成一个页头块，而不是页头下面吊了
             一条窄带。px-6 落在列表上（横带整幅由 PageShell 给）。 */
          <TabsList className="w-fit px-6 group-data-horizontal/tabs:h-10" variant="line">
            {PROJECT_TABS.map((value) => (
              <TabsTrigger className="cursor-pointer px-3" key={value} value={value}>
                {t(`projectSettings.tabs.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        }
        title={t("projectSettings.title", { name: project.name })}
      >
        <TabsContent className="h-full" value="general">
          <ProjectGeneralSection key={project.id} chats={projectChats} project={project} />
        </TabsContent>
        <TabsContent className="h-full" value="personalization">
          <ProjectInstructionsSection key={project.id} project={project} />
        </TabsContent>
        <TabsContent className="h-full" value="skills">
          <ProjectSkillsSection key={project.id} project={project} />
        </TabsContent>
        <TabsContent className="h-full" value="extensions">
          <SettingsCanvas>
            <ExtensionsContent
              description={t("projectSettings.extensions.scopeNote")}
              projectLifecycleRevision={project.projectLifecycleRevision}
              packageIdentity={searchParams.get("package")}
              scope={extensionScope}
            />
          </SettingsCanvas>
        </TabsContent>
        <TabsContent className="h-full" value="tools">
          <ProjectToolsSettings key={project.id} project={project} />
        </TabsContent>
      </PageShell>
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
  const mcpController = useMemo(
    () => createMcpServersController({
      kind: "project",
      projectId: project.id,
    }),
    [project.id]
  );
  const tools = useSyncExternalStore(
    toolsController.subscribe,
    toolsController.getSnapshot
  );
  const mcp = useSyncExternalStore(
    mcpController.subscribe,
    mcpController.getSnapshot
  );
  const backendFacts = useMemo(
    () => (setup.status?.backends ?? []).map(toolBackendFacts),
    [setup.status?.backends]
  );
  const projectedMcp = useMemo(() => mcp.value ? ({
    ...mcp.value,
    servers: mcp.value.servers.map((server) =>
      projectManualMcpServerSupport(server, backendFacts)
    ),
  }) : null, [backendFacts, mcp.value]);

  useEffect(() => {
    void toolsController.load();
    return () => {
      toolsController.dispose();
      mcpController.dispose();
    };
  }, [mcpController, toolsController]);

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
    snapshot: projectedMcp,
    loading: mcp.loading,
    error:
      mcp.error === MCP_SERVERS_BRIDGE_UNAVAILABLE
        ? t("settings.tools.mcp.bridgeMissing")
        : mcp.error,
    bridgeAvailable: mcp.bridgeAvailable,
    pending: new Set([...mcp.pending, ...tools.pending]),
    hasPolicyOverrides: hasMcpOverrides,
    load: mcpController.load,
    save: async (draft, server) => {
      const ok = await mcpController.save(draft, server);
      return {
        ok,
        error: ok ? "" : mcpController.getSnapshot().error,
      };
    },
    remove: mcpController.remove,
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
  }), [
    hasMcpOverrides,
    mcp,
    mcpController,
    projectedMcp,
    t,
    tools.pending,
    toolsController,
  ]);

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
