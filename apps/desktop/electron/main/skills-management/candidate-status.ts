/**
 * [INPUT]: Depends on shared unified-skills-ipc candidate/status/reason types, package SkillFolderInspection and library-store entry type (type-only)
 * [OUTPUT]: Provides CandidateAuthority, OwnerFacts, CandidateClassification, buildOwnerFacts (library entries → name-keyed owner facts), classifyCandidates (the single new/update/current/blocked decision incl. intra-batch first-seen-owns-name and the refined name-taken family) and candidateView (authority + classification → renderer DTO)
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

/* 一个 name 的库内事实：谁占着它、活跃代的内容身份是什么。
   digest 可空只为批内先见者——它可能是个超预算未哈希的候选；
   库内条目的活跃代 digest 恒在（导入时 hashAll 补算）。 */
export type OwnerFacts = Readonly<{
  sourceIdentity: string;
  digest: `sha256:${string}` | null;
  sourceRevision: string | null;
}>;

export type CandidateClassification =
  | Readonly<{ status: "new" | "update" | "current" }>
  | Readonly<{ status: "blocked"; reason: ManagedSkillReason }>;

export function buildOwnerFacts(entries: readonly ManagedSkillsLibraryEntry[]) {
  return new Map<string, OwnerFacts>(entries.map((entry) => {
    const active = entry.generations.find((item) => item.generationId === entry.activeGenerationId)!;
    return [entry.name, {
      sourceIdentity: entry.provenance.sourceIdentity,
      digest: active.digest as `sha256:${string}`,
      sourceRevision: active.sourceRevision ?? null,
    }];
  }));
}

/* ── 候选结局只判一次 ────────────────────────────────────────────
 * 从前这套 owner 遍历写了两遍：refreshCandidates 里数「未纳管」，
 * nameTakenRefs 里挑「收不进来」——同一个问题两份真相源。现在四种结局
 * （new / update / current / blocked）出自同一张表、同一次循环：
 *
 * 1. 读不出来 → blocked（勘察理由原样带出）；
 * 2. 他源占名 → blocked，内容可比时三分：同内容 name-taken-same、
 *    异内容 name-taken-differs、任一侧 digest 缺失退回裸 name-taken；
 * 3. 无主 → new，且批内先见者当场占名（库内与批内本是同一个问题）；
 * 4. 同源：digest 在场比 digest；候选超预算未哈希时比导入复核存下的
 *    sourceRevision；旧库条目缺 sourceRevision 一律判 update——
 *    一次同内容 no-op 导入即回填愈合，永不多唠叨第二回。
 * ──────────────────────────────────────────────────────────── */
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
    if (owner && owner.sourceIdentity !== authority.sourceIdentity) {
      out.set(authority.ref, { status: "blocked", reason: nameTakenReason(skill.digest, owner.digest) });
      continue;
    }
    if (!owner) {
      working.set(skill.name, {
        sourceIdentity: authority.sourceIdentity,
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

function nameTakenReason(
  candidateDigest: `sha256:${string}` | null,
  ownerDigest: `sha256:${string}` | null
): ManagedSkillReason {
  if (!candidateDigest || !ownerDigest) return { code: "name-taken" };
  return { code: candidateDigest === ownerDigest ? "name-taken-same" : "name-taken-differs" };
}

function sameContent(
  skill: Readonly<{ digest: `sha256:${string}` | null; revision: string }>,
  owner: OwnerFacts
) {
  if (skill.digest && owner.digest) return skill.digest === owner.digest;
  return owner.sourceRevision !== null && skill.revision === owner.sourceRevision;
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
  "missing-skill-md", "name-taken", "name-taken-differs", "name-taken-same",
  "not-a-directory", "postcondition-changed", "ref-invalid", "skill-md-too-large",
  "source-gone", "symlink", "timeout", "too-many-candidates",
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
