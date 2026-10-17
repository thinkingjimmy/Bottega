/**
 * [INPUT]: Shared preset DTOs and exact Expense/Fitness source publication, compatibility, requirements and icon facts.
 * [OUTPUT]: FIRST_PARTY_PRESETS and PresetCatalog with stable IDs, source directories, canonical URLs and immutable pins.
 * [POS]: apps/desktop/electron/main/presets; The main process trust root for preset source identity and install facts; renderer projects product copy from presetId through its locale catalog
 */

import type { PresetAppSummary } from "../../../shared/ipc/apps/apps-ipc";

export type PresetCatalogEntry = PresetAppSummary & {
  canonicalRepoUrl: string;
  catalogPin: string;
  sourceDirectory: string;
};

export const FIRST_PARTY_PRESETS = [
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
