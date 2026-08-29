/**
 * [INPUT]: Depends on i18n, Setup/runtime facts, global Settings owner, scoped MCP controller, shared built-in specs, PageShell, and the two scope-port Sections
 * [OUTPUT]: Provides live-Setup-projected global Tools defaults for every Project and independent Chat without exposing Project-owned resources
 * [POS]: Settings › Tools global-default composition root; adapters translate global owners into the same ports used by Project Settings
 */

import { Wrench } from "lucide-react";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { PageShell } from "@/components/page-shell";
import {
  BUILTIN_TOOL_COPY,
  BuiltinToolsSection,
  type BuiltinToolsSectionPort,
} from "@/components/settings/builtin-tools-section";
import {
  McpServersSection,
  type McpServersSectionPort,
} from "@/components/settings/mcp-servers-section";
import { SettingsCanvas } from "@/components/settings/settings-layout";
import { settingsStore } from "@/lib/settings-store";
import { createMcpServersController } from "@/lib/mcp-servers-client";
import { MCP_SERVERS_BRIDGE_UNAVAILABLE } from "../../shared/mcp-servers-ipc";
import {
  projectEffectiveState,
  projectManualMcpServerSupport,
  resolveBuiltinBackendSupportMatrix,
  toolBackendFacts,
} from "../../shared/tool-support";

/* ============================================================
 * 这一页曾有三种「工具」，只有两种能被加进来——于是「添加」在一页里
 * 有两个入口、两种语义，而位置最显赫的那个语义最窄。补救办法当时是
 * 把两个动作各自塞回它管着的段头，靠段标题去圆。
 *
 * Skill 仓库搬去扩展页之后，那个歧义没有了词源：这页只剩一个可增删的东西
 * （MCP server），它的动作就在它那段的段头，再没有第二个「添加」需要
 * 与之区分。整套 snapshot/busy/error 状态机也跟着它服务的那一段一起
 * 离开——一页只在自己还管着状态时才需要状态。
 *
 * 顺序曾按扫读代价排——MCP 一眼看得完，内置那 26 项是查而不是改，
 * 于是沉在后面。那把「翻起来省不省事」当成了排序的依据，而它排的其实
 * 是主次：进这一页的人问的是「这个产品能做什么」，翻到的却先是「我往
 * 里接了什么」。一份宿主能力清单，头一段却是外挂。
 *
 * 现在按归属排：内置工具是本产品自己的能力，是这一页的主语，故在前；
 * MCP 是接进来的第三方，是补充，故在后。可增删的那段沉底也没有代价——
 * 它的动作长在自己的段头上，从来不需要靠位置显赫来被找到。
 *
 * 页头是补回来的：这页与 Agent Plugins 当年从 Apps 的页签升格成设置档时，
 * 旧注释写着「页头归 Settings shell」——可 shell 从来没有页头，于是它们成了
 * 全项目仅有的两张无名页面。无名的代价不是难看：侧栏一收起，人就没有任何
 * 东西能回答「我现在在哪一页」，而另外五档设置一直都答得上来。
 * 图标与侧栏同一枚：同一个目的地在两处必须长同一张脸。
 * ============================================================ */

export function ToolsPanel() {
  const { t } = useAppTranslation();
  const setup = useSetup();
  const settings = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );
  const mcpController = useMemo(
    () => createMcpServersController({ kind: "global" }),
    []
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
    settingsStore.ensureLoaded();
    return () => mcpController.dispose();
  }, [mcpController]);

  const builtinPort = useMemo<BuiltinToolsSectionPort>(() => {
    const disabled = new Set(settings.settings?.disabledBuiltinTools ?? []);
    return {
      kind: "global",
      ready: Boolean(settings.settings && setup.status),
      error: settings.error,
      hasOverrides: false,
      tools: Object.keys(BUILTIN_TOOL_COPY).map((toolId) => {
        const intentEnabled = !disabled.has(toolId);
        const backendSupport = resolveBuiltinBackendSupportMatrix(
          toolId,
          backendFacts
        );
        return {
          toolId,
          intentEnabled,
          override: null,
          source: "global-default",
          effectiveState: projectEffectiveState(intentEnabled, backendSupport),
          backendSupport,
        };
      }),
      setEnabled: (toolId, enabled) =>
        settingsStore.update(
          (current) => ({
            disabledBuiltinTools: enabled
              ? current.disabledBuiltinTools.filter((item) => item !== toolId)
              : [...new Set([...current.disabledBuiltinTools, toolId])],
          }),
          t("settings.tools.builtin.saveFailed")
        ),
    };
  }, [backendFacts, settings.error, settings.settings, setup.status, t]);
  const mcpPort = useMemo<McpServersSectionPort>(() => ({
    kind: "global",
    snapshot: projectedMcp,
    loading: mcp.loading,
    error:
      mcp.error === MCP_SERVERS_BRIDGE_UNAVAILABLE
        ? t("settings.tools.mcp.bridgeMissing")
        : mcp.error,
    bridgeAvailable: mcp.bridgeAvailable,
    pending: mcp.pending,
    hasPolicyOverrides: false,
    load: mcpController.load,
    save: async (draft, server) => {
      const ok = await mcpController.save(draft, server);
      return {
        ok,
        error: ok ? "" : mcpController.getSnapshot().error,
      };
    },
    remove: mcpController.remove,
  }), [mcp, mcpController, projectedMcp, t]);
  return (
    <PageShell icon={<Wrench />} title={t("common.tools")}>
      <SettingsCanvas>
        <div className="space-y-8">
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t("settings.tools.globalScopeNote")}
          </p>
          <BuiltinToolsSection port={builtinPort} />
          <McpServersSection port={mcpPort} />
        </div>
      </SettingsCanvas>
    </PageShell>
  );
}
