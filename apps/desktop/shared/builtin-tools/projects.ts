/**
 * [INPUT]: Depends on the zod and the type of spec for the builtin-tools/platform
 * [OUTPUT]: Provides convert_chat_to_project and exact-issued commit_managed_worktree built-in tool static specs
 * [POS]: The project is a true source of builtin-tools; Just down the platform
 */

import { z } from "zod";
import type { BuiltinToolSpec } from "./platform";

export const PROJECT_TOOL_SPECS = [
  {
    name: "convert_chat_to_project",
    domainId: "projects",
    access: "mutate",
    manualTurnOnly: true,
    /* 全仓唯一的后端白名单，且执行面 fail-open（无白名单=全放行）。
       opencode 显式不进：v1 不承接 Project 转换语义。 */
    backendAllowlist: ["codex", "claude"],
    description:
      "把当前 chat 归入新建的 Project 分组。调用前必须在当前会话内获得用户明确同意。转换仅建立分组：不创建文件夹、不切换工作目录，下一轮仍使用 Chat Home；后续可在设置中为 Project 绑定工作目录。",
    inputSchema: z
      .object({ name: z.string().trim().min(1).max(100) })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  {
    name: "commit_managed_worktree",
    domainId: "projects",
    access: "mutate",
    exactIssued: true,
    planExcluded: true,
    description:
      "Commit all current changes in this Chat's Bottega-managed Git worktree. The Chat identity, incarnation, branch, and repository are fixed by the main-owned turn lease; provide only a concise commit message. If there are no changes, the tool returns committed=false.",
    inputSchema: z
      .object({ message: z.string().trim().min(1).max(200) })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
] as const satisfies readonly BuiltinToolSpec[];
