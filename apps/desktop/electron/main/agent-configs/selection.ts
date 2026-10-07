/**
 * [INPUT]: Canonical built-in Provider ids from shared/providers/builtin; Depends on Local Skill library and MCP inventories, native Skill sources, prepared receipts and frozen workflow resources.
 * [OUTPUT]: Provides workflowInventory, workflowNativeSkillRoots, workflowSkillSelection and workflowToolSelection; resource identity and digests must match.
 * [POS]: Local resource boundary for workflow configuration and turn preparation; secrets stay in main custody.
 */
import { BUILTIN_PROVIDER_IDS } from "../../../shared/providers/builtin";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { AgentConfigInventory } from "@ai-chat/cloud-protocol/agent-config/payload";
import type { PreparedSkillSelectionReceipt } from "../../../shared/ipc/agent/agent-ipc";
import type { ManagedSkillsLibraryStore } from "../skills-management/library-store";
import type { ManualMcpServersStore } from "../tools/mcp/store";
import type { WorkflowTurnPolicy } from "../workflows/turn-policy";
import type { ProjectToolsPreparationSnapshot } from "../sections/coordinator/admission/prepared-project-tools";
import type { SkillsExtension } from "../backends/types";

/** Native discovery must not add Skills beyond the frozen library receipt. Staged copies remain readable. */
export function workflowNativeSkillRoots(provider: string, workspace: string, sources?: SkillsExtension) {
  const roots = new Set<string>();
  for (let path = workspace; ; path = dirname(path)) {
    roots.add(join(path, ".agents", "skills"));
    for (const source of sources?.sources(path) ?? []) roots.add(source.path);
    if (path === dirname(path)) break;
  }
  if (provider === BUILTIN_PROVIDER_IDS.codex) {
    roots.add(join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "skills"));
    roots.add("/etc/codex/skills");
  }
  if (provider === BUILTIN_PROVIDER_IDS.opencode) {
    roots.add(join(homedir(), ".agents", "skills"));
    roots.add(join(homedir(), ".opencode", "skills"));
    roots.add(join(homedir(), ".opencode", "skill"));
  }
  return [...roots];
}

export function workflowInventory(library: ManagedSkillsLibraryStore, mcp: ManualMcpServersStore, projectId?: string): AgentConfigInventory {
  return {
    skills: new Map(library.snapshot().entries.flatMap(entry => {
      const generation = entry.generations.find(item => item.generationId === entry.activeGenerationId);
      return entry.enabled && entry.tombstoneAt === null && generation && existsSync(join(library.packagePath(entry), "SKILL.md"))
        ? [[`library:${entry.libraryId}`, generation.digest] as const] : [];
    })),
    mcpServers: new Map(mcp.resolved(projectId ? { kind: "project", projectId } : { kind: "global" })
      .filter(server => server.enabled && server.eligibility === "eligible")
      .map(server => [server.serverId, server.configDigest])),
  };
}

/** The prepared receipt pins the selected library generation, even when the workspace has ambient Skills. */
export function workflowSkillSelection(receipt: PreparedSkillSelectionReceipt, policy: WorkflowTurnPolicy | null): PreparedSkillSelectionReceipt {
  const selection = policy?.resources?.skills ?? [];
  const candidates = selection.map(selected => {
    const candidate = receipt.candidates.find(item => item.sourceKind === "library" && item.ownerRef === selected.id);
    if (!candidate?.enabled || candidate.digest !== selected.digest) throw new Error(`agent-config-skill-unavailable:${selected.id}`);
    return candidate;
  });
  return Object.freeze({ ...receipt, candidates: Object.freeze(candidates) });
}

/** Filtering precedes sealed custody and session identity, so unrelated servers neither start nor trigger session reuse. */
export function workflowToolSelection(snapshot: ProjectToolsPreparationSnapshot, policy: WorkflowTurnPolicy | null): ProjectToolsPreparationSnapshot {
  const selection = policy && !policy.readOnly ? policy.resources?.mcpServers ?? [] : [];
  const candidates = selection.map(selected => {
    const candidate = snapshot.mcpCandidates.find(item => item.serverId === selected.id);
    if (!candidate?.enabled || candidate.eligibility !== "eligible" || candidate.configDigest !== selected.digest) {
      throw new Error(`agent-config-mcp-unavailable:${selected.id}`);
    }
    return candidate;
  });
  return { ...snapshot, mcpCandidates: candidates };
}
