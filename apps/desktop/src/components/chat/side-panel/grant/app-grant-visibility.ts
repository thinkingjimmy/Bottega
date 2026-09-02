/**
 * [INPUT]: Depends on the shared AppAgentVisibility DTO owned by main
 * [OUTPUT]: Provides AppVisibilityIssues and appVisibilityIssues(visibility, appId)
 * [POS]: The single derivation of "this App had trouble last turn"; the tab badge reads the boolean, the banner reads the detail
 */

import type { AppAgentVisibility } from "../../../../../shared/apps-ipc";

type Excluded = AppAgentVisibility["excludedComponents"][number];

export type AppVisibilityIssues = {
  /** 整个 App 没进上一轮上下文；Agent 不知道它存在 */
  omission: AppAgentVisibility["omittedApps"][number] | null;
  /** App 进了，但能力面被收窄 */
  degradations: readonly AppAgentVisibility["degradedApps"][number][];
  /** App 进了，但这些扩展 component 没交付 */
  excluded: readonly Excluded[];
  /** 徽标只需要这一个布尔；细节归横幅 */
  hasIssue: boolean;
};

const NONE: AppVisibilityIssues = {
  omission: null,
  degradations: [],
  excluded: [],
  hasIssue: false,
};

/* ============================================================
 * 为什么这条推导必须独占一个模块
 *
 * 「tab 上那颗盾要不要变琥珀」与「App 顶上要不要长出横幅」问的是同一件事，
 * 只是一个要布尔、一个要细节。两处各写一遍 filter/find，就是给同一个事实
 * 开两个真相源——某天有人给 degradedApps 加一种 reason，只改了横幅那边，
 * 盾便安静地继续说「一切正常」。而「界面说没事、实际有事」正是这块面板
 * 一开始就该消灭的病。
 *
 * 未收到 visibility 事件时返回 NONE 而非「未知」：没有证据就不宣称有事，
 * 也不宣称没事——徽标此刻说的是授权档位，它本就与本轮可见性无关。
 * ============================================================ */
export function appVisibilityIssues(
  visibility: AppAgentVisibility | undefined,
  appId: string
): AppVisibilityIssues {
  if (!visibility) return NONE;
  const omission =
    visibility.omittedApps.find((item) => item.appId === appId) ?? null;
  const degradations = visibility.degradedApps.filter(
    (item) => item.appId === appId
  );
  const excluded = visibility.excludedComponents.filter(
    (item) => item.appId === appId
  );
  if (!omission && !degradations.length && !excluded.length) return NONE;
  return {
    omission,
    degradations,
    excluded,
    hasIssue: true,
  };
}
