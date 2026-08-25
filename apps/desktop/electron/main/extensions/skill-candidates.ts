/**
 * [INPUT]: Depends on authoritative inventory, content addresses package roots and catalog frontmatter analysis
 * [OUTPUT]: Provides collectExtensionSkillCandidates: Only the manual-snapshot skill that is administrative active + global catalog enabled + component enabled becomes a candidate
 * [POS]: Extensions to SkillsCatalog are read-only projections; The candidates are not the ledger, the catalog is still just a filtered list (F25)
 */

import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import type { ExtensionInventorySnapshot } from "../../../shared/extensions-ipc";
import { parseSkillFrontmatter, type CatalogSkill } from "../skills-catalog";

const SKILL_FILE_LIMIT = 128 * 1024;

/* 包内容是内容寻址落盘的，所以根可由 contentDigest 推导——registry 不必再存
   一份路径，也就不存在「记录里的路径与磁盘不一致」这种第二真相。 */
export function extensionPackageRoot(userData: string, contentDigest: string) {
  return join(
    userData,
    "agent-extensions",
    "packages",
    contentDigest.replace(/^sha256:/, "")
  );
}

export async function collectExtensionSkillCandidates(input: {
  userData: string;
  inventory: ExtensionInventorySnapshot;
}): Promise<CatalogSkill[]> {
  const candidates: CatalogSkill[] = [];
  for (const owner of input.inventory.packages) {
    /* 三重收窄缺一不可：包已启用、该 component 被逐项启用、且它就是那条被四家
       真机证明过的 manual-snapshot 通道。安装 ≠ 启用 ≠ 可交付。 */
    if (
      owner.administrativeState !== "active" ||
      !owner.globalCatalogEnabled ||
      !owner.activeGenerationRef
    ) continue;
    const generation = owner.generations.find(
      (item) =>
        item.packageGenerationId === owner.activeGenerationRef!.packageGenerationId
    );
    if (!generation) continue;
    const root = extensionPackageRoot(input.userData, generation.contentDigest);
    for (const component of input.inventory.components) {
      if (
        component.kind !== "skill" ||
        component.transport !== "manual-snapshot" ||
        component.packageGenerationRef.packageGenerationId !==
          generation.packageGenerationId ||
        !owner.enabledComponentIdentities.includes(component.componentIdentity)
      ) {
        continue;
      }
      const skill = await readCandidate(root, component.componentId);
      if (skill) candidates.push(skill);
    }
  }
  return candidates;
}

/* `componentId` 形如 `skill:<name>`，目录即 `<root>/skills/<name>`。读不出来就
   不产出候选——宁可少一条，也不让 catalog 指向一个解析不了的路径。 */
async function readCandidate(
  root: string,
  componentId: string
): Promise<CatalogSkill | null> {
  const name = componentId.replace(/^skill:/, "");
  if (!name || name.includes("/") || name.includes("..")) return null;
  const file = join(root, "skills", name, "SKILL.md");
  try {
    const metadata = await lstat(file);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.size > SKILL_FILE_LIMIT
    ) {
      return null;
    }
    /* 与 catalog 同一条 containment 口径：canonical 之后仍须留在包根内。 */
    const canonical = await realpath(file);
    const location = relative(await realpath(root), canonical);
    if (location.startsWith("..") || isAbsolute(location)) return null;
    return {
      ref: randomUUID(),
      path: canonical,
      scope: "extension",
      ...parseSkillFrontmatter(await readFile(canonical, "utf8"), name),
    };
  } catch {
    return null;
  }
}
