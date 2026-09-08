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
    catalogPin: "8ef25085e43720d7359cdb9864c8d0db4ac920e0",
    sourceDirectory: "Bottega-app-design-canvas",
    factoryTreeDigest:
      "sha256:80f1f06330b000551114100705bde9d40a6a00f8a121fa5d9927ded10bd595ae",
  },
  {
    id: "dev-kanban",
    icon: "🧭",
    requirements: [],
    canonicalRepoUrl:
      "https://github.com/thinkingjimmy/Bottega-app-dev-kanban.git",
    catalogPin: "43825844e726d89b52aeb789fff6df6a62b033b5",
    sourceDirectory: "Bottega-app-dev-kanban",
  },
  {
    id: "expense-tracker",
    icon: "💰",
    requirements: [],
    canonicalRepoUrl:
      "https://github.com/thinkingjimmy/Bottega-app-expense-tracker.git",
    catalogPin: "88fd198eae486738a19c4304e1cc60d5f9497a80",
    sourceDirectory: "Bottega-app-expense-tracker",
  },
  {
    id: "fitness-log",
    icon: "🏋️",
    requirements: [],
    canonicalRepoUrl:
      "https://github.com/thinkingjimmy/Bottega-app-fitness-log.git",
    catalogPin: "f50e4ae4036dc4d570267f9c9a4cb50fa94f49f7",
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
