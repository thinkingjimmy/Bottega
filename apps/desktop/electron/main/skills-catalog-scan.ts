/**
 * [INPUT]: Depends on backend-declared project/system roots, guarded Node filesystem reads, canonical Skill frontmatter, and catalog wire types
 * [OUTPUT]: Provides bounded root scanning, managed-first discovery reservation, owner-priority deduplication/truncation, backend-late Extension alternative preservation, frontmatter parsing, and workspace discovery results
 * [POS]: Filesystem discovery helper for skills-catalog; it reads project/system roots only and owns no cache, IPC, token, or turn authority
 */

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import type { SkillInfo } from "../../shared/skills-ipc";
import { orderedBackends } from "./backends";
import type { CatalogSkill } from "./skills-catalog";
import { SKILL_FRONTMATTER_PATTERN } from "./skills-management/skill-frontmatter";

export const SKILL_FILE_LIMIT = 128 * 1024;
export const SKILL_COUNT_LIMIT = 256;
const SKILL_DISCOVERY_LIMIT = 4_096;
const SKILL_DEPTH_LIMIT = 2;
const SOURCE_PRIORITY = {
  library: 4,
  extension: 3,
  project: 2,
  system: 1,
} as const;
const SCOPE_PRIORITY: Record<CatalogSkill["scope"], number> = {
  user: 4,
  admin: 4,
  extension: 3,
  repo: 2,
  system: 1,
};

export function parseSkillFrontmatter(content: string, fallbackName: string) {
  const block = SKILL_FRONTMATTER_PATTERN.exec(content)?.[1] ?? "";
  const fields = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    fields.set(match[1]!, match[2]!.replace(/^['"]|['"]$/g, ""));
  }
  const name = fields.get("name")?.trim() || fallbackName;
  const description = fields.get("description")?.trim() || `Skill: ${name}`;
  const displayName = fields.get("displayName")?.trim();
  const rawRequires = fields.get("requires")?.trim();
  const requires: SkillInfo["requires"] = rawRequires || undefined;
  return {
    name,
    description,
    ...(displayName ? { displayName } : {}),
    ...(requires ? { requires } : {}),
  };
}

async function scanSkillRoot(
  root: string,
  scope: CatalogSkill["scope"],
  output: Map<string, CatalogSkill>
) {
  let canonicalRoot: string;
  try {
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return;
    canonicalRoot = await realpath(root);
  } catch {
    return;
  }
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > SKILL_DEPTH_LIMIT || output.size >= SKILL_DISCOVERY_LIMIT) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (output.size >= SKILL_DISCOVERY_LIMIT) return;
      const path = resolve(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) continue;
      const canonical = await realpath(path);
      const location = relative(canonicalRoot, canonical);
      if (location.startsWith("..") || isAbsolute(location)) continue;
      if (metadata.isDirectory()) {
        if (!entry.name.startsWith(".")) await visit(path, depth + 1);
        continue;
      }
      if (
        entry.name !== "SKILL.md" ||
        !metadata.isFile() ||
        metadata.size > SKILL_FILE_LIMIT
      ) {
        continue;
      }
      if (output.has(canonical)) continue;
      const content = await readFile(path, "utf8");
      const detail = parseSkillFrontmatter(content, basename(dirname(path)));
      /* ref 与 ownerRef 同值：对外引用与内部授权共用同一个稳定身份，
         chip 的 ref 不再随扫描轮换。 */
      output.set(canonical, {
        ref: `filesystem:${canonical}`,
        path: canonical,
        scope,
        sourceKind: scope === "repo" ? "project" : "system",
        generationRef: { kind: "filesystem", path: canonical },
        digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
        enabled: true,
        ownerRef: `filesystem:${canonical}`,
        ...detail,
      });
    }
  };
  await visit(canonicalRoot, 0);
}

export async function scanSkillRoots(
  roots: Array<{ root: string; scope: CatalogSkill["scope"] }>,
  extra: readonly CatalogSkill[] = []
) {
  return (await scanSkillRootsResult(roots, extra)).skills;
}

export async function scanSkillRootsResult(
  roots: Array<{ root: string; scope: CatalogSkill["scope"] }>,
  extra: readonly CatalogSkill[] = []
) {
  const output = new Map<string, CatalogSkill>();
  /* Managed candidates own the scarce discovery seats. Root discovery fills only
     the remainder, so a large project cannot erase the user's Library. */
  for (const skill of [...extra].sort(compareCatalogSkills)) {
    if (output.size >= SKILL_DISCOVERY_LIMIT) break;
    output.set(skill.path, skill);
  }
  for (const { root, scope } of roots) await scanSkillRoot(root, scope, output);
  const ordered = [...output.values()].sort(compareCatalogSkills);
  const byName = new Map<string, CatalogSkill>();
  for (const skill of ordered) {
    const current = byName.get(skill.name);
    if (!current || sourcePriority(skill) > sourcePriority(current)) {
      byName.set(skill.name, skill);
    }
  }
  /* Truncation is another ownership decision, not presentation sorting. Keep
     Library/Extension entries before project/system entries at the 256 edge. */
  /* D13 cannot run until the backend probe is known. Keep every Extension
     alternative that shares the winning Extension slug; collapsing here would
     discard global fallback or the exact Project owner before eligibility can
     make the authoritative choice. Other source kinds retain ordinary slug
     deduplication. */
  const winners = [...byName.values()];
  const alternatives = ordered.filter((skill) => {
    const winner = byName.get(skill.name);
    return (
      winner?.sourceKind === "extension" &&
      skill.sourceKind === "extension" &&
      skill.ownerRef !== winner.ownerRef
    );
  });
  const all = [...winners, ...alternatives].sort(compareCatalogSkills);
  return {
    skills: all.slice(0, SKILL_COUNT_LIMIT),
    truncated: all.length > SKILL_COUNT_LIMIT,
    totalCount: all.length,
    all,
    scanTruncated: output.size >= SKILL_DISCOVERY_LIMIT,
  };
}

function sourcePriority(skill: CatalogSkill) {
  return skill.sourceKind
    ? SOURCE_PRIORITY[skill.sourceKind]
    : SCOPE_PRIORITY[skill.scope];
}

function compareCatalogSkills(left: CatalogSkill, right: CatalogSkill) {
  return sourcePriority(right) - sourcePriority(left) ||
    left.name.localeCompare(right.name) ||
    left.path.localeCompare(right.path);
}

export async function scanSkillsResult(
  workspace: string,
  extra: readonly CatalogSkill[] = []
) {
  const sources = new Map<string, CatalogSkill["scope"]>();
  for (const backend of orderedBackends()) {
    for (const source of backend.skills?.sources(workspace) ?? []) {
      if (source.scope === "user") continue;
      const key = resolve(source.path);
      if (!sources.has(key)) sources.set(key, source.scope);
    }
  }
  return scanSkillRootsResult(
    [...sources].map(([root, scope]) => ({ root, scope })),
    extra
  );
}
