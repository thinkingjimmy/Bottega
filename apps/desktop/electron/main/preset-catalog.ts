/**
 * [INPUT]: Depends on shared preset DTO; Publishing metadata, canonical GitHub URLs and immutable commit pins are both held by product source code
 * [OUTPUT]: Provides FIRST_PARTY_PRESETS, PresetCatalog with closed lookup according to presetId
 * [POS]: The main leader provides a trust root; A table of card documents with the same release identity, and the renderer is not allowed to provide URL/pin
 */

import type { PresetAppSummary } from "../../shared/apps-ipc";

export type PresetCatalogEntry = PresetAppSummary & {
  canonicalRepoUrl: string;
  catalogPin: string;
};

export const FIRST_PARTY_PRESETS = [
  {
    id: "dev-kanban",
    name: "开发看板",
    description:
      "用任务与问题两类结构化记录推进开发，让计划、实现、评审和收口始终可追踪。",
    icon: "🧭",
    requirements: [],
    readme:
      "# Development Kanban\n\nA first-party ordinary Base App for tasks, findings, implementation chats, and review handoffs.",
    readmeZhCN:
      "# 开发看板\n\n用结构化任务和问题替代私有工作流引擎：看板保存事实，对话负责编排。",
    canonicalRepoUrl:
      "https://github.com/thinkingjimmy/Bottega-app-dev-kanban.git",
    catalogPin: "2213e8983ce46c8804c96950af21bd1f3cde1200",
  },
  {
    id: "expense-tracker",
    name: "记账本",
    description:
      "一句话记一笔开销，自动落成结构化账目，随时看分类占比与每日趋势。",
    icon: "💰",
    requirements: [],
    readme:
      "# Expense Tracker\n\nRecord expenses in plain language and review category and daily trends.",
    readmeZhCN:
      "# 记账本\n\n用一句话记录日期、金额、分类和备注，并查看分类占比与每日趋势。",
    canonicalRepoUrl:
      "https://github.com/thinkingjimmy/Bottega-app-expense-tracker.git",
    catalogPin: "910eb2939d5eee9784f315b9823cc57d7cc6bea3",
  },
  {
    id: "fitness-log",
    name: "健身日志",
    description:
      "区分计划与完成训练，浏览离线动作目录，并用只读人体热力图查看已完成组数覆盖。",
    icon: "🏋️",
    requirements: [],
    readme:
      "# Fitness Log\n\nTrack planned and completed workouts, browse the offline exercise catalog, and inspect completed-set muscle coverage.",
    readmeZhCN:
      "# 健身日志\n\n区分计划与完成训练，浏览离线动作目录，并查看只读肌肉覆盖热力图。",
    canonicalRepoUrl:
      "https://github.com/thinkingjimmy/Bottega-app-fitness-log.git",
    catalogPin: "8b95e845bdb517dfe40fa264fd02c3188eb3d2b6",
  },
] as const satisfies readonly PresetCatalogEntry[];

export class PresetCatalog {
  private readonly entries = new Map<string, PresetCatalogEntry>(
    FIRST_PARTY_PRESETS.map((entry) => [entry.id, entry])
  );

  list(): PresetAppSummary[] {
    return [...this.entries.values()].map(
      ({ canonicalRepoUrl: _url, catalogPin: _pin, ...summary }) =>
        structuredClone(summary)
    );
  }

  require(presetId: string): PresetCatalogEntry {
    const entry = this.entries.get(presetId);
    if (!entry) throw new Error(`预设 App 不存在：${presetId}`);
    return structuredClone(entry);
  }
}
