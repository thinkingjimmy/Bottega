/**
 * [INPUT]: Depends on shared unified-skills-ipc candidate/status/reason types, package SkillFolderInspection and library-store entry type (type-only)
 * [OUTPUT]: Provides CandidateAuthority, OwnerFacts, CandidateClassification, buildOwnerFacts (library entries → name-keyed owner facts), classifyCandidates (the single new/update/current/blocked decision incl. intra-batch first-seen-owns-name) and candidateView (authority + classification → renderer DTO)
 * [POS]: The single classifier of skills-management; refreshCandidates counting, held-preview blocking and the candidate DTO all consume this one decision — one judgment, written once
 */

import type {
  ManagedSkillAgent,
  ManagedSkillCandidate,
  ManagedSkillCandidateError,
  ManagedSkillReason,
} from "../../../shared/unified-skills-ipc";
import type { ManagedSkillsLibraryEntry } from "./library-store";
import type { SkillFolderInspection } from "./package";

export type CandidateAuthority = Readonly<{
  ref: string;
  agent: ManagedSkillAgent | "local-folder";
  sourcePath: string;
  sourceRoot: string;
  sourceIdentity: string;
  inspection: SkillFolderInspection;
}>;

/* The in-library fact for one name: what the active generation's content identity is.
   digest is nullable only for an intra-batch first-seen owner — it may be an
   over-budget candidate that wasn't hashed; a library entry's active-generation
   digest is always present (hashAll backfills it on import). */
export type OwnerFacts = Readonly<{
  digest: `sha256:${string}` | null;
  sourceRevision: string;
}>;

export type CandidateClassification =
  | Readonly<{ status: "new" | "update" | "current" }>
  | Readonly<{ status: "blocked"; reason: ManagedSkillReason }>;

export function buildOwnerFacts(entries: readonly ManagedSkillsLibraryEntry[]) {
  return new Map<string, OwnerFacts>(entries.filter(entry => entry.tombstoneAt === null).map((entry) => {
    const active = entry.generations.find((item) => item.generationId === entry.activeGenerationId)!;
    return [entry.name, {
      digest: active.digest as `sha256:${string}`,
      sourceRevision: active.sourceRevision,
    }];
  }));
}

/* ── A candidate's outcome is judged exactly once ─────────────────────────
 * This owner walk used to be written twice: refreshCandidates counted
 * "unmanaged", nameTakenRefs picked out "can't be admitted" — two sources of
 * truth for the same question. Now all four outcomes (new / update / current /
 * blocked) come out of the same table, in the same pass:
 *
 * 1. Unreadable -> blocked (the inspection reason is passed through as-is);
 * 2. Unowned -> new, and an intra-batch first-seen candidate claims the name
 *    on the spot (the in-library and intra-batch cases are the same problem);
 * 3. Owned: compare digest when present; for an over-budget unhashed candidate,
 *    compare against the sourceRevision recorded at import review — a matching
 *    name means another generation of the same Skill, so import just adds a
 *    generation.
 * ────────────────────────────────────────────────────────────────────────── */
export function classifyCandidates(
  authorities: Iterable<CandidateAuthority>,
  owners: ReadonlyMap<string, OwnerFacts>
) {
  const working = new Map(owners);
  const out = new Map<string, CandidateClassification>();
  for (const authority of authorities) {
    const inspection = authority.inspection;
    if (!inspection.importable) {
      out.set(authority.ref, { status: "blocked", reason: inspection.reason });
      continue;
    }
    const skill = inspection.skill;
    const owner = working.get(skill.name);
    if (!owner) {
      working.set(skill.name, {
        digest: skill.digest,
        sourceRevision: skill.revision,
      });
      out.set(authority.ref, { status: "new" });
      continue;
    }
    out.set(authority.ref, { status: sameContent(skill, owner) ? "current" : "update" });
  }
  return out;
}

function sameContent(
  skill: Readonly<{ digest: `sha256:${string}` | null; revision: string }>,
  owner: OwnerFacts
) {
  if (skill.digest && owner.digest) return skill.digest === owner.digest;
  return skill.revision === owner.sourceRevision;
}

/* 发现流程的文件系统失败翻成稳定的公开理由码：原始 errno 与路径
   只进 main 日志，永不过 IPC。 */
export function safeReason(cause: unknown): ManagedSkillReason {
  const reason = (cause as { reason?: unknown } | null)?.reason;
  if (typeof reason === "string" && MANAGED_REASON_CODES.includes(reason as ManagedSkillReason["code"])) {
    return { code: reason as ManagedSkillReason["code"] };
  }
  const code = (cause as NodeJS.ErrnoException | null)?.code;
  if (code === "EACCES" || code === "EPERM") return { code: "unreadable" };
  if (code === "ENOENT") return { code: "missing" };
  if (code === "ETIMEDOUT") return { code: "timeout" };
  return { code: "unknown" };
}

const MANAGED_REASON_CODES = [
  "acquisition-failed", "changed", "invalid-frontmatter", "invalid-name", "missing",
  "missing-skill-md", "not-a-directory", "postcondition-changed", "ref-invalid",
  "skill-md-too-large", "source-gone", "symlink", "timeout", "too-many-candidates",
  "too-many-directories", "unreadable", "unknown", "unsafe-path",
] as const satisfies readonly ManagedSkillReason["code"][];

/* ── 同一个文件夹只报一次 ──────────────────────────────────────────
 * `~/.agents/skills` 被 kimi 与 opencode 各扫一遍，codex 又从原生清单里
 * 看见同一个目录——于是一个读不动的文件夹在界面上排成三条红字，读者以为
 * 自己有三个问题。同一 (名字, 理由, 细节) 就是同一件事，报一次即可。
 * ────────────────────────────────────────────────────────────── */
export function dedupeErrors(errors: readonly ManagedSkillCandidateError[]) {
  const seen = new Set<string>();
  return errors.filter((item) => {
    const key = `${item.label}\u0000${item.reason.code}\u0000${item.reason.detail ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function candidateView(
  authority: CandidateAuthority,
  classification: CandidateClassification
): ManagedSkillCandidate {
  const inspection = authority.inspection;
  /* 理由不冒充描述：它有自己的位置，也有自己的语言。 */
  const blockedView = (name: string, revision: string, reason: ManagedSkillReason): ManagedSkillCandidate => ({
    ref: authority.ref,
    agent: authority.agent,
    name,
    displayName: name,
    description: "",
    digest: null,
    revision,
    files: 0,
    bytes: 0,
    status: "blocked",
    importable: false,
    reason,
    preview: "",
  });
  if (!inspection.importable) return blockedView(inspection.name, inspection.revision, inspection.reason);
  if (classification.status === "blocked") {
    return blockedView(inspection.skill.name, inspection.skill.revision, classification.reason);
  }
  return {
    ref: authority.ref,
    agent: authority.agent,
    name: inspection.skill.name,
    displayName: inspection.skill.displayName,
    description: inspection.skill.description,
    digest: inspection.skill.digest,
    revision: inspection.skill.revision,
    files: inspection.skill.files.length,
    bytes: inspection.skill.bytes,
    status: classification.status,
    importable: true,
    reason: null,
    preview: inspection.skill.preview,
  };
}
