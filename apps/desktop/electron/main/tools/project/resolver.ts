/**
 * [INPUT]: Depends on global Settings and MCP storage, Project lifecycle authority, mode selection, and built-in tool issuance
 * [OUTPUT]: Provides ProjectToolsResolver to freeze global settings in the context of an admitted turn
 * [POS]: Main-owned policy projection shared by turn preparation and Skills requirements
 */

import type { PluginToolName } from "../../../../shared/plugin-tools";
import type { ProviderId } from "@bottega/contracts/model/provider";
import type { PluginModeSelection } from "@bottega/contracts/plugins/platform";
import type { ProjectStore } from "../../projects/store/project-store";
import type { ProjectToolsPreparationSnapshot } from "../../sections/coordinator/admission/prepared-project-tools";
import { modeToolSelection } from "../../sections/coordinator/turns/mode-admission";
import { projectBuiltinTools } from "../issuance";
import type { ManualMcpServersStore } from "../mcp/store";

type GlobalBuiltinToolSettings = Readonly<{
  revision: number;
  disabledTools: readonly PluginToolName[];
}>;

export class ProjectToolsResolver {
  constructor(
    private readonly projects: ProjectStore,
    private readonly mcpServers: ManualMcpServersStore,
    private readonly globalSettings: () => GlobalBuiltinToolSettings
  ) {}

  resolve(input: Readonly<{
    projectId: string | null;
    backend: ProviderId;
    builtinTools: "none" | "read" | "mutate";
    planMode: boolean;
    mode?: PluginModeSelection;
  }>): ProjectToolsPreparationSnapshot {
    const { projectId, backend, builtinTools, planMode, mode } = input;
    const projectContext = this.projects.turnContext(projectId);
    const { revision, disabledTools } = this.globalSettings();
    return {
      projectContext,
      resourceVersion: {
        scope: projectId === null ? { kind: "global" } : { kind: "project", projectId },
        projectLifecycleRevision: projectContext.projectLifecycleRevision,
        scopeRevision: revision,
      },
      policyRevisions: { global: revision, project: null },
      mcpScopeRevisions: { global: this.mcpServers.scopeRevision(), project: null },
      builtinIntent: { disabledTools },
      allowedTools: projectBuiltinTools({
        ...modeToolSelection({ backend, mode }),
        builtinTools,
        backend,
        planMode,
        origin: {
          kind: "manual",
          queryText: "",
          userText: "",
          userMessageId: "project-tools-preparation",
        },
        disabledTools,
        useSkill: false,
      }),
      mcpCandidates: this.mcpServers.resolved(),
    };
  }
}
