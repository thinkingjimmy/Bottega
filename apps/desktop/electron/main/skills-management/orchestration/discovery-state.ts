/**
 * [INPUT]: Depends on candidate authorities, target roots, the provider catalog (which CLIs read the cross-agent root), import previews, and shared source status DTOs
 * [OUTPUT]: Provides the in-memory discovery snapshot, held-preview projection, stable private identities, and source counters
 * [POS]: Path-private discovery state adapter for UnifiedSkillsService
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  ManagedSkillAgent,
  ManagedSkillCandidateError,
  ManagedSkillImportPreview,
  ManagedSkillSourceView,
} from "../../../../shared/ipc/agent/unified-skills-ipc";
import type { CandidateAuthority } from "../candidate-status";
import type { SkillFolderInspection } from "../package";
import { resolveSharedSkillsRoot, type ManagedSkillTarget } from "../metadata/targets";
import { providerCatalog } from "../../providers/host/catalog";

export const AGENTS = ["codex", "claude", "kimi", "opencode"] as const;

export type HeldImport = ManagedSkillImportPreview & {
  authorities: ReadonlyMap<string, CandidateAuthority>;
};

export type CandidateState = ReturnType<typeof emptyCandidateState>;

export function sourceViews(
  state: CandidateState,
  installed: ReadonlySet<ManagedSkillAgent>
): ManagedSkillSourceView[] {
  return [...new Set<string>([...AGENTS, ...state.byAgent.keys()])].map((agent) => {
    const errors = state.errors.filter((error) => error.agent === agent);
    return {
      source: agent,
      status: !installed.has(agent) ? "not-installed"
        : errors.length ? "failed"
        : (state.byAgent.get(agent)?.length ?? 0) ? "ok" : "missing",
      actionable: state.unmanagedByAgent[agent] ?? 0,
      current: state.upToDateByAgent[agent] ?? 0,
      bytes: state.bytesByAgent[agent] ?? 0,
      errors,
    };
  });
}

export function candidateAuthority(
  agent: ManagedSkillAgent | "local-folder",
  sourcePath: string,
  sourceRoot: string,
  inspection: SkillFolderInspection
): CandidateAuthority {
  return {
    ref: randomUUID(), agent, sourcePath, sourceRoot,
    sourceIdentity: privateIdentity(sourcePath), inspection,
  };
}

export function publicPreview(held: HeldImport): ManagedSkillImportPreview {
  return {
    previewId: held.previewId,
    revision: held.revision,
    source: held.source,
    candidates: held.candidates,
    errors: held.errors,
  };
}

export function emptyCandidateState() {
  return {
    revision: "",
    byAgent: new Map<ManagedSkillAgent, CandidateAuthority[]>(),
    unmanagedByAgent: emptyCounts(),
    upToDateByAgent: emptyCounts(),
    bytesByAgent: emptyCounts(),
    unmanagedBytes: 0,
    errors: [] as ManagedSkillCandidateError[],
  };
}

export function emptyCounts(agents: readonly ManagedSkillAgent[] = AGENTS): Record<ManagedSkillAgent, number> {
  return Object.fromEntries(agents.map(agent => [agent, 0]));
}

export function discoveryRoots(target: ManagedSkillTarget, userHome: string) {
  /* A CLI that reads the cross-agent root (descriptor `skills.readsSharedRoot`) is scanned there too; Claude reads only its own. */
  const lookup = providerCatalog().catalog().get(target.agent);
  return lookup.known && lookup.entry.descriptor.skills?.readsSharedRoot
    ? [target.path, resolveSharedSkillsRoot(userHome)]
    : [target.path];
}

export function privateIdentity(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function digestJson(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
