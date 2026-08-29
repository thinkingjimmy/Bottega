/**
 * [INPUT]: Depends on zod and the builtin-tools platform read contract
 * [OUTPUT]: Provides the exact-issued, non-ambient use_skill tool specification
 * [POS]: Shared wire truth for loading a frozen turn Skill; settings and ambient issuance deliberately exclude it
 */

import { z } from "zod";
import { read, type BuiltinToolSpec } from "./platform";

export const USE_SKILL_DESCRIPTION =
  "按名称加载一个产品 Skill 的完整说明（SKILL.md）。当 [Skills] 清单中某项的描述命中当前任务时，先调用本工具再依说明执行；清单未列出但已启用的项同样可按名称取用。本轮消息已由用户 $ 附带的项不要重复加载。";

export const SKILL_TOOL_SPECS = [
  {
    name: "use_skill",
    domainId: "skills",
    description: USE_SKILL_DESCRIPTION,
    access: "read",
    exactIssued: true,
    inputSchema: z
      .object({
        name: z.string().min(1).max(64),
      })
      .strict(),
    annotations: read,
  },
] as const satisfies readonly BuiltinToolSpec[];
