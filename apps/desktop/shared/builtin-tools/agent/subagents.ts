/**
 * [INPUT]: Depends on zod, the Provider catalog's subagent-assign bit and the type of spec for the builtin-tools/platform
 * [OUTPUT]: Provides spawn_subagent built-in tool static spec
 * [POS]: apps/desktop/shared/builtin-tools/agent; Authoritative source for the Subagents domain of builtin-tools; depends on platform.ts and the Provider catalog
 */

import { z } from "zod";
import { assignableProviders } from "../../providers/builtin";
import type { BuiltinToolSpec } from "../platform";

export const SUBAGENT_TOOL_SPECS = [
  {
    name: "spawn_subagent",
    domainId: "subagents",
    access: "mutate",
    description:
      "在当前回合内启动一次性 Subagent，阻塞等待结果后继续推理。prompt 必须自包含：子任务没有审批或追问通道，也没有内置工具（Base/Section/浏览器）、本轮附加的 App 与 skill——只能读写其工作区文件与联网（视权限档）。Base/Section 类任务不要委派，自己做。父回合为逐条审批时，子进程自动降为 workspace 只读且禁网；其他已授权档位继承 workspace 写入与网络。",
    crossReferences: [
      {
        mentions: ["promote_result_to_section", "create_section"],
        text: "一次性任务完成后需持久化结果请尽快用 promote_result_to_section；直接启动持久协作请用 create_section。",
      },
    ],
    inputSchema: z
      .object({
        /* As in sections: product policy from the descriptor's `subagent-assign` bit, not a registry projection. */
        agent: z.enum(assignableProviders("subagent-assign")),
        prompt: z.string().trim().min(1).max(32 * 1024),
        name: z.string().trim().min(1).max(100).optional(),
        timeout_seconds: z.number().int().min(30).max(600).default(300),
      })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
] as const satisfies readonly BuiltinToolSpec[];
