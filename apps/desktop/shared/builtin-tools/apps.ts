/**
 * [INPUT]: Depends on the zod and the type of spec for the builtin-tools/platform
 * [OUTPUT]: Provides validate_app built-in tool static spec
 * [POS]: The app is a true source of builtin-toolsJust down the platform
 */

import { z } from "zod";
import { read, type BuiltinToolSpec } from "./platform";

export const APP_TOOL_SPECS = [
  {
    name: "validate_app",
    domainId: "apps",
    access: "read",
    description:
      "只读自检当前编辑 chat 绑定的 App 包，与安装/分享共用同一套校验器：manifest 严格 schema、包白名单（表外文件分享时会被剥离）、AGENTS.md 与 CLAUDE.md 约定、skill frontmatter、data/base.json 快照形状、requirements 的 configKey 归一。返回 errors/warnings（file + reason），不修改任何文件。只有编辑 chat 可用。",
    inputSchema: z.object({}).strict(),
    annotations: read,
  },
] as const satisfies readonly BuiltinToolSpec[];
