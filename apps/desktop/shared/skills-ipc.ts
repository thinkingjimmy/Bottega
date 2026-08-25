/**
 * [INPUT]: Depends on shared/agent-ipc's AgentWorkspaceScope, does not accept cwd/path
 * [OUTPUT]: Provides skills catalog, Plan capability, generation changed Events and preload bridge contracts
 * [POS]: The manual Skill of shared modules is to discover the truth source, the renderer only holds the main opaque ref that is issued
 */

import type {
  AgentBackendId,
  AgentWorkspaceScope,
} from "./agent-ipc";

export type SkillsScope = AgentWorkspaceScope;

export type SkillInfo = {
  ref: string;
  name: string;
  description: string;
  /* extension = 产品受管扩展包里被逐项启用的 skill；它排在 user 之下，
     用户自己 `~/.agents/skills` 的同名件永远压过装进来的包。 */
  scope: "user" | "repo" | "system" | "admin" | "extension";
  displayName?: string;
  /** 未知原子要求也保留，由 catalog 两个出口 fail-closed 排除。 */
  requires?: string;
};

export type SkillsListInput = {
  scope: SkillsScope;
  backend: AgentBackendId;
  planMode: boolean;
};

export const SKILLS_CHANNEL = {
  list: "skills:list",
  capabilities: "skills:capabilities",
  changed: "skills:changed",
} as const;

export type SkillsChangedEvent = { generation: number };

export type SkillsBridgeApi = {
  list: (input: SkillsListInput) => Promise<SkillInfo[]>;
  capabilities: (scope: SkillsScope) => Promise<{ plan: boolean }>;
  onChanged: (callback: (event: SkillsChangedEvent) => void) => () => void;
};
