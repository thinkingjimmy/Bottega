/**
 * [INPUT]: Depends on the shared AppInfo contract only
 * [OUTPUT]: Provides REPOSITORY_URL, ISSUES_URL, and reportIssueUrl, which turns a title, a body, and optional app facts into a prefilled GitHub new-issue link
 * [POS]: The single renderer authority for "report this on GitHub" destinations; About and failure notices share it instead of each spelling the repository
 */

import type { AppInfo } from "../../shared/update-ipc";

export const REPOSITORY_URL = "https://github.com/thinkingjimmy/Bottega";
export const ISSUES_URL = `${REPOSITORY_URL}/issues`;

/* 正文末尾带上版本与平台：这是维护者第一句要问的话，让用户不必再答一轮。
   渲染层还没拿到 appInfo 就不写，绝不编一个。 */
export function reportIssueUrl(input: {
  title: string;
  body: string;
  appInfo?: Pick<AppInfo, "version" | "platform" | "electron"> | null;
}) {
  const facts = input.appInfo
    ? `\n\n---\nBottega ${input.appInfo.version} · ${input.appInfo.platform} · Electron ${input.appInfo.electron}`
    : "";
  const params = new URLSearchParams({ title: input.title, body: `${input.body}${facts}` });
  return `${ISSUES_URL}/new?${params.toString()}`;
}
