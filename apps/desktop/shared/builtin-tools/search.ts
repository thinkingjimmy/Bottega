/**
 * [INPUT]: Depends on zod and builtin-tools/platform read annotations/spec
 * [OUTPUT]: Provides search_chat_history/search_bases
 * [POS]: The truth about the Search area of builtin-tools; Just down the platform
 */

import { z } from "zod";
import { read, type BuiltinToolSpec } from "./platform";

const searchInput = z
  .object({
    query: z.string().trim().min(1).max(256),
    cursor: z.string().max(256).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

const contract =
  "查询按归一化空白分词并执行全 token AND；超过 16 个 token 返回 400。结果含 skipped_sections；cursor 绑定工具种类与 query，不能跨查询复用。";

export const SEARCH_TOOL_SPECS = [
  {
    name: "search_chat_history",
    domainId: "search",
    access: "read",
    description: "跨全部 Section 搜索标题与已落盘转录，返回 title/message 判别定位键；",
    crossReferences: [
      {
        mentions: ["read_section"],
        text: `用 read_section(from_seq) 读取正文。${contract}`,
      },
    ],
    inputSchema: searchInput,
    annotations: read,
  },
  {
    name: "search_bases",
    domainId: "search",
    access: "read",
    description:
      "跨全部 Base owner 搜索名称、列名与 canonical 单元格文本，每个 Project Base 只返回一次；返回 locator（owner_key 与 section_id）。",
    crossReferences: [
      {
        mentions: ["read_base"],
        text: `用 read_base 按 locator 的 section_id 读取正文；section_id 为 null 的零成员 Project Base 只可展示、不能跳转。${contract}`,
      },
    ],
    inputSchema: searchInput,
    annotations: read,
  },
] as const satisfies readonly BuiltinToolSpec[];
