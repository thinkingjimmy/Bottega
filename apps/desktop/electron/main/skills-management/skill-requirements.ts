/**
 * [INPUT]: Depends on shared builtin-tool specs, one Skill requires expression, and the final issued ambient tool names
 * [OUTPUT]: Provides the canonical requires eligibility predicate without filesystem, Electron, or catalog dependencies
 * [POS]: Pure eligibility gate shared by EffectiveSkillSnapshot and catalog send-time revalidation
 */

import { builtinToolSpec } from "../../../shared/builtin-tools";

export function skillRequirementSatisfied(
  requirement: string | undefined,
  allowedTools: readonly string[]
) {
  if (!requirement) return true;
  const allowed = new Set(allowedTools);
  const specs = allowedTools.flatMap((name) => {
    const spec = builtinToolSpec(name);
    return spec ? [spec] : [];
  });
  if (requirement === "builtin-tools: read") return specs.length > 0;
  if (requirement === "builtin-tools: mutate") {
    return specs.some((spec) => spec.access === "mutate");
  }
  const domain = /^tools:\s+([a-z][a-z0-9-]*):(read|mutate)$/.exec(
    requirement
  );
  if (domain) {
    const [, domainId, access] = domain;
    return specs.some(
      (spec) => spec.domainId === domainId && spec.access === access
    );
  }
  const exact = /^tools:\s+([a-z][a-z0-9_]*(?:\s*,\s*[a-z][a-z0-9_]*)*)$/.exec(
    requirement
  );
  if (exact) {
    const names = exact[1]!.split(",").map((name) => name.trim());
    return names.every(
      (name) => builtinToolSpec(name) !== undefined && allowed.has(name)
    );
  }
  return false;
}
