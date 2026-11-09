/**
 * [INPUT]: Depends on each official feature's tool declarations and the host infrastructure declarations.
 * [OUTPUT]: Provides officialToolPlugins: plugin-owned schemas, stable identities and execution classification.
 * [POS]: Declaration discovery for official plugins; it contains no tool-name list or main-process handler wiring.
 */
import { HISTORY_TOOL_SPECS } from "../chat-agent/history-tool";
import { APP_TOOL_SPECS } from "./catalog/apps";
import { BASE_TOOL_SPECS } from "./catalog/bases";
import { BROWSER_TOOL_SPECS } from "./catalog/browser";
import { DESIGN_TOOL_SPECS } from "./catalog/design";
import { PROJECT_TOOL_SPECS } from "./catalog/projects";
import { SECTION_TOOL_SPECS } from "./catalog/sections";
import { SEARCH_TOOL_SPECS } from "./catalog/search";
import { PLUGIN_TOOL_SPECS } from "./plugins";
import { PREVIEW_TOOL_SPECS } from "./preview";
import { SKILL_TOOL_SPECS } from "./agent/skills";
import { DATAVIZ_TOOL_SPECS } from "./agent/dataviz";
import { SUBAGENT_TOOL_SPECS } from "./agent/subagents";

import type { PluginToolSpec } from "./platform";

export type OfficialToolPlugin = Readonly<{
  id: string; alias: string; name: string; copyable: boolean; alwaysOn?: boolean; hostInfrastructure?: boolean;
  nativeFeature?: "memory" | "dock" | "sketch";
  dependencies: readonly string[]; tools: readonly PluginToolSpec[];
}>;
const feature = (id: string, name: string, tools: readonly PluginToolSpec[], dependencies: readonly string[] = [], alwaysOn = false): OfficialToolPlugin =>
  ({ id: id === "tunnel" ? "preview" : id, alias: id, name, tools, dependencies, copyable: tools.length > 0, ...(!tools.length ? { nativeFeature: id as OfficialToolPlugin["nativeFeature"] } : {}), ...(alwaysOn ? { alwaysOn } : {}) });
const core = (id: string, tools: readonly PluginToolSpec[]): OfficialToolPlugin =>
  ({ id: `host_${id}`, alias: id, name: id, tools, dependencies: [], copyable: false, hostInfrastructure: true, alwaysOn: true });

export const officialToolPlugins: readonly OfficialToolPlugin[] = [
  feature("base", "Base", BASE_TOOL_SPECS, [], true),
  feature("browser", "Browser", BROWSER_TOOL_SPECS),
  feature("artifact", "Artifact", DESIGN_TOOL_SPECS),
  feature("tunnel", "Preview", PREVIEW_TOOL_SPECS),
  feature("skills", "Skills", DATAVIZ_TOOL_SPECS),
  feature("apps", "Apps", APP_TOOL_SPECS),
  feature("memory", "Memory", []), feature("dock", "Dock", []), feature("sketch", "Sketch", []),
  core("sections", SECTION_TOOL_SPECS), core("subagents", SUBAGENT_TOOL_SPECS),
  core("projects", PROJECT_TOOL_SPECS), core("search", SEARCH_TOOL_SPECS),
  core("history", HISTORY_TOOL_SPECS), core("skills", SKILL_TOOL_SPECS),
  core("plugins", PLUGIN_TOOL_SPECS),
];
