/**
 * [INPUT]: Depends on shared ChatSummary/Project contract
 * [OUTPUT]: Provides draftRoute, projectAlive, projectDraftRoute and chatExitRoute
 * [POS]: lib's "where is the blank page" rule; The sidewall rebuilds, archives backwards and the chat/base routes are shared by the same writing and judgement
 */

import type { ChatSummary } from "../../shared/chats-ipc";
import type { Project } from "../../shared/projects-ipc";

/* ============================================================
 * 空白页只有一张，却有两种归属：根级的 `/`，与 Project 级的
 * `/?projectId=X`。两者渲染同一条草稿会话，差别只在 composer 的
 * Project 槽——引导语因此带上 Project 名，侧栏也据此点亮那一行。
 *
 * 路径写法收在这里，是因为它有三个写者（侧栏「+」、归档回落、路由
 * 守卫）。三个人各拼一次字符串，就是三次把 query 名写错的机会。
 * ============================================================ */
export const draftRoute = (projectId?: string | null) =>
  projectId ? `/?projectId=${encodeURIComponent(projectId)}` : "/";

/** 「这个 Project 还立得住吗」只有一个判据：不是占位，也没被归档。 */
export const projectAlive = (project: Project | undefined) =>
  Boolean(project && !project.missing && !project.archivedAt);

const find = (projects: Project[], projectId: string | null | undefined) =>
  projectId
    ? projects.find((candidate) => candidate.id === projectId)
    : undefined;

/** Project 自己还立得住才去它的空白页，否则落回根级。 */
export const projectDraftRoute = (
  projectId: string | null | undefined,
  projects: Project[]
) => (projectAlive(find(projects, projectId)) ? draftRoute(projectId) : "/");

/* ============================================================
 * 「这条 chat 还能留在自己的页面上吗」——留不住就一并说清该去哪。
 *
 * 归档不是删除：「它属于哪个 Project」是归档之后依然成立的事实，
 * 所以用户该落在那个 Project 的空白页上继续说下一句话，而不是被甩
 * 回根级从头找路，更不该被甩进 Archive 列表页。只有 Project 自己
 * 也失效（丢失/归档）时，根级才是唯一去处。
 *
 * 返回 null 即留下。判据与目的地同源，两处守卫因此不可能对同一条
 * chat 给出两种说法。
 * ============================================================ */
export function chatExitRoute(
  summary: ChatSummary,
  projects: Project[]
): string | null {
  if (summary.projectId && !projectAlive(find(projects, summary.projectId))) {
    return "/";
  }
  return summary.effectiveArchived ? draftRoute(summary.projectId) : null;
}
