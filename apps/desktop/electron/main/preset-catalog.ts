/**
 * [INPUT]: Depends on the shared preset DTO; product source owns publishing metadata, canonical GitHub URLs, immutable pins, and the packaged React Design factory digest
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
    catalogPin: "13e0558131b55fce96d5392797be0bf12e72d272",
    sourceDirectory: "Bottega-app-design-canvas",
    factoryTreeDigest:
      "sha256:b3bdc4105f25d83124a250179388f07e09dc2160d7fd55e87b52909194240786",
  },
  {
    id: "dev-kanban",
    icon: "🧭",
    requirements: [],
    canonicalRepoUrl:
      "https://github.com/thinkingjimmy/Bottega-app-dev-kanban.git",
    catalogPin: "03300161eea6c53e7233ba79774a8760ab3eb3e4",
    sourceDirectory: "Bottega-app-dev-kanban",
  },
  {
    id: "expense-tracker",
    icon: "💰",
    requirements: [],
    canonicalRepoUrl:
      "https://github.com/thinkingjimmy/Bottega-app-expense-tracker.git",
    catalogPin: "8ad2ba85acdea3379c31819ca2f502af564e5cd1",
    sourceDirectory: "Bottega-app-expense-tracker",
  },
  {
    id: "fitness-log",
    icon: "🏋️",
    requirements: [],
    canonicalRepoUrl:
      "https://github.com/thinkingjimmy/Bottega-app-fitness-log.git",
    catalogPin: "2147526a3ae4371fceca41407bc7b237bbe00a46",
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
