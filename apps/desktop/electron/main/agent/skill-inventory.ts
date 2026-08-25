/**
 * [INPUT]: Depends on start-up system/extension skill loader, extension registry Change subscription and unification requires determiner
 * [OUTPUT]: Provides SkillInventoryIndex and the Trusted-rated SkillSummary are not interchangeable; extension only retains slug name/requires, turn read path zero disk access
 * [POS]: The agent's Skill inventory layer of the product determination; and `$` SkillsCatalog panel Unlocked, rejected user/workspace scope
 */

import type { CatalogSkill } from "../skills-catalog";
import { skillRequirementSatisfied } from "../skills-catalog";

const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DISPLAY_NAME_LIMIT = 32;

function hasControlOrLineBreak(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    );
  });
}

export type SkillSummary = Readonly<{
  name: string;
  scope: "system" | "extension";
  displayName?: string;
  requires?: string;
}>;

export type SkillInventoryDependencies = Readonly<{
  loadSystemSkills: () => Promise<readonly CatalogSkill[]>;
  loadExtensionSkills: () => Promise<readonly CatalogSkill[]>;
  subscribeExtensionChanges?: (
    listener: () => Promise<void>
  ) => () => void;
  debug?: (message: string) => void;
}>;

export class SkillInventoryIndex {
  private system: readonly SkillSummary[] = Object.freeze([]);
  private extensions: readonly SkillSummary[] = Object.freeze([]);
  private combined: readonly SkillSummary[] = Object.freeze([]);
  private initialized = false;
  private unsubscribe?: () => void;

  constructor(private readonly dependencies: SkillInventoryDependencies) {}

  async initialize() {
    if (this.initialized) return;
    this.system = this.sanitize(
      await this.dependencies.loadSystemSkills(),
      "system"
    );
    await this.refreshExtensions();
    this.unsubscribe = this.dependencies.subscribeExtensionChanges?.(() =>
      this.refreshExtensions()
    );
    this.initialized = true;
  }

  snapshot(allowedTools: readonly string[]): readonly SkillSummary[] {
    if (!this.initialized) throw new Error("SkillInventoryIndex 尚未初始化");
    return Object.freeze(
      this.combined.filter((skill) =>
        skillRequirementSatisfied(skill.requires, allowedTools)
      )
    );
  }

  close() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.initialized = false;
    this.system = Object.freeze([]);
    this.extensions = Object.freeze([]);
    this.combined = Object.freeze([]);
  }

  private async refreshExtensions() {
    this.extensions = this.sanitize(
      await this.dependencies.loadExtensionSkills(),
      "extension"
    );
    const byName = new Map(this.system.map((skill) => [skill.name, skill]));
    for (const skill of this.extensions) byName.set(skill.name, skill);
    this.combined = Object.freeze(
      [...byName.values()].sort((left, right) =>
        left.name.localeCompare(right.name)
      )
    );
  }

  private sanitize(
    candidates: readonly CatalogSkill[],
    expectedScope: SkillSummary["scope"]
  ) {
    const output: SkillSummary[] = [];
    for (const candidate of candidates) {
      const rawDisplayName = candidate.displayName;
      const displayName = rawDisplayName?.trim();
      const validDisplayName =
        rawDisplayName === undefined ||
        (!hasControlOrLineBreak(rawDisplayName) &&
          [...(displayName ?? "")].length <= DISPLAY_NAME_LIMIT);
      const valid =
        candidate.scope === expectedScope &&
        SKILL_NAME.test(candidate.name) &&
        validDisplayName;
      if (!valid) {
        this.dependencies.debug?.(
          `[skills] 忽略不合规 ${expectedScope} skill metadata`
        );
        continue;
      }
      output.push(
        Object.freeze({
          name: candidate.name,
          scope: expectedScope,
          ...(expectedScope === "system" && displayName
            ? { displayName }
            : {}),
          ...(candidate.requires ? { requires: candidate.requires } : {}),
        })
      );
    }
    return Object.freeze(output);
  }
}
