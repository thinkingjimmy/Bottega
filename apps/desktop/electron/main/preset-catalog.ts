/**
 * [INPUT]: Depends on the shared preset DTO; product source owns publishing metadata, canonical GitHub URLs, immutable pins, and optional packaged factory digests
 * [OUTPUT]: Provides FIRST_PARTY_PRESETS and PresetCatalog with stable presetId, sourceDirectory, canonical URL, immutable source/compatibility pin, requirements, icons, and optional factory tree digest
 * [POS]: The main process trust root for preset source identity and install facts; renderer projects product copy from presetId through its locale catalog
 */

import type { PresetAppSummary } from "../../shared/apps-ipc";

export type PresetCatalogEntry = PresetAppSummary & {
  canonicalRepoUrl: string;
  catalogPin: string;
  sourceDirectory: string;
  factoryTreeDigest?: `sha256:${string}`;
};

export const FIRST_PARTY_PRESETS = [
  {
    id: "design-canvas",
    icon: "✦",
    requirements: [],
    canonicalRepoUrl:
      "https://github.com/thinkingjimmy/Bottega-app-design-canvas.git",
    catalogPin: "1add29324e02b50f88d3a4b694281add30a440bf",
    sourceDirectory: "Bottega-app-design-canvas",
    factoryTreeDigest:
      "sha256:ac7f7e798e59eee42160f1eedbacedc87b7275da8db15a22ea608f080b11bfc2",
  },
  {
    id: "dev-kanban",
    icon: "🧭",
    requirements: [],
    canonicalRepoUrl:
      "https://github.com/thinkingjimmy/Bottega-app-dev-kanban.git",
    catalogPin: "2213e8983ce46c8804c96950af21bd1f3cde1200",
    sourceDirectory: "Bottega-app-dev-kanban",
  },
  {
    id: "expense-tracker",
    icon: "💰",
    requirements: [],
    canonicalRepoUrl:
      "https://github.com/thinkingjimmy/Bottega-app-expense-tracker.git",
    catalogPin: "910eb2939d5eee9784f315b9823cc57d7cc6bea3",
    sourceDirectory: "Bottega-app-expense-tracker",
  },
  {
    id: "fitness-log",
    icon: "🏋️",
    requirements: [],
    canonicalRepoUrl:
      "https://github.com/thinkingjimmy/Bottega-app-fitness-log.git",
    catalogPin: "8b95e845bdb517dfe40fa264fd02c3188eb3d2b6",
    sourceDirectory: "Bottega-app-fitness-log",
  },
] as const satisfies readonly PresetCatalogEntry[];

export class PresetCatalog {
  private readonly entries = new Map<string, PresetCatalogEntry>(
    FIRST_PARTY_PRESETS.map((entry) => [entry.id, entry])
  );

  list(): PresetAppSummary[] {
    return [...this.entries.values()].map(
      ({
        canonicalRepoUrl: _url,
        catalogPin: _pin,
        sourceDirectory: _directory,
        factoryTreeDigest: _factoryDigest,
        ...summary
      }) =>
        structuredClone(summary)
    );
  }

  require(presetId: string): PresetCatalogEntry {
    const entry = this.entries.get(presetId);
    if (!entry) throw new Error(`预设 App 不存在：${presetId}`);
    return structuredClone(entry);
  }
}
