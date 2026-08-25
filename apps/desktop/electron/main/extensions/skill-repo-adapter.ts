/**
 * [INPUT]: Depends on the rigorous Skill of the manifest-adapter
 * [OUTPUT]: Provides skill-repo-1.0.0 admission, only skills/<name>The following is the list of the official languages of the Republic of Moldova
 * [POS]: The expansion of the Naked Skill Warehouse adapter; Not to parse plugin.json, not to introduce MCP capabilities
 */

import type { ExtensionSourceProvenance } from "./registry-store";
import {
  discoverSkills,
  canonicalDirectory,
  type ExtensionAdmissionDiagnostic,
  type ExtensionPackageAdmission,
} from "./manifest-adapter";

export const SKILL_REPO_ADAPTER_ID = "skill-repo-1.0.0";
export const SKILL_REPO_SCHEMA_ID = "ai-chat://schemas/skill-repo/1.0.0";

export async function admitSkillRepoPackage(
  root: string,
  source: ExtensionSourceProvenance
): Promise<ExtensionPackageAdmission> {
  const packageRoot = await canonicalDirectory(root);
  const diagnostics: ExtensionAdmissionDiagnostic[] = [];
  const components = await discoverSkills(packageRoot, diagnostics);
  const repositoryName = source.normalizedUrl
    .replace(/\/$/, "")
    .split("/")
    .at(-1)
    ?.replace(/\.git$/, "") || "skill-repository";
  const valid = components.length > 0;
  if (!valid) {
    diagnostics.push({
      severity: "error",
      scope: "package",
      path: "skills",
      message: "skill-repo 至少需要一个有效的 skills/<name>/SKILL.md",
    });
  }
  return {
    adapterId: SKILL_REPO_ADAPTER_ID,
    pluginRoot: packageRoot,
    manifest: { name: repositoryName },
    unknownManifestFields: [],
    components,
    diagnostics,
    valid,
    containsStdio: false,
  };
}
