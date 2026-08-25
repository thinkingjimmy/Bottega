/**
 * [INPUT]: Depends on zod and builtin-tools/platform read/mutation annotations/spec
 * [OUTPUT]: Provides BrowserAction to distinguish between combined, non-$ref wire, and browser-based five tools static spec
 * [POS]: The source of the truth in the Browser domain of the builtin-tools; Batch processing DSL is the only protocol that the Agent can perform web actions on
 */

import { z } from "zod";
import { browserTabIdSchema, browserUrlSchema } from "../browser-ipc";
import {
  mutation,
  read,
  type BuiltinToolSpec,
} from "./platform";

const refSchema = z.string().regex(/^e[1-9][0-9]*_[1-9][0-9]*$/);
const keySchema = z.string().trim().min(1).max(64);
const action = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).strict();

export const browserActionSchema = z.discriminatedUnion("type", [
  action({ type: z.literal("goto"), url: browserUrlSchema }),
  action({ type: z.literal("click"), ref: refSchema }),
  action({
    type: z.literal("fill"),
    ref: refSchema,
    value: z.string().max(32 * 1024),
  }),
  action({ type: z.literal("press"), key: keySchema }),
  action({
    type: z.literal("select"),
    ref: refSchema,
    value: z.string().max(8 * 1024),
  }),
  action({
    type: z.literal("scroll"),
    ref: refSchema.optional(),
    dy: z.number().finite().min(-100_000).max(100_000),
  }),
  action({
    type: z.literal("wait_for"),
    text: z.string().trim().min(1).max(4_096).optional(),
    ref: refSchema.optional(),
    timeout_ms: z.number().int().min(100).max(10_000).default(5_000),
  }).refine((value) => Boolean(value.text || value.ref), {
    message: "wait_for 必须提供 text 或 ref",
  }),
  action({
    type: z.literal("eval"),
    fn: z.string().trim().min(1).max(16 * 1024),
  }),
  action({ type: z.literal("back") }),
  action({ type: z.literal("forward") }),
  action({ type: z.literal("reload") }),
]);

export type BrowserAction = z.infer<typeof browserActionSchema>;

const tabInput = z.object({ tab_id: browserTabIdSchema }).strict();
const actionsInput = z
  .object({
    tab_id: browserTabIdSchema,
    actions: z.array(browserActionSchema).min(1).max(20),
  })
  .strict();
const actionWire = z
  .looseObject({})
  .describe(
    "Browser action 判别对象：goto{url} / click{ref} / fill{ref,value} / press{key} / select{ref,value} / scroll{ref?,dy} / wait_for{text?|ref?,timeout_ms?} / eval{fn} / back / forward / reload。"
  );

export const BROWSER_TOOL_SPECS = [
  {
    name: "browser_open",
    domainId: "browser",
    access: "mutate",
    planExcluded: true,
    description:
      "在当前 Section 名下打开 http(s) 网页并返回 tab_id 与压缩可访问性快照。先 open，再依据快照 ref 批量 act。",
    inputSchema: z.object({ url: browserUrlSchema }).strict(),
    annotations: mutation,
  },
  {
    name: "browser_snapshot",
    domainId: "browser",
    access: "read",
    planExcluded: true,
    description:
      "读取本 Section 所有或用户当前可见 tab 的压缩可访问性树。结果 ref 只对这版快照有效。",
    inputSchema: tabInput,
    annotations: read,
  },
  {
    name: "browser_act",
    domainId: "browser",
    access: "mutate",
    planExcluded: true,
    description:
      "按顺序执行最多 20 个网页动作；失败或用户停止即停批，并只在批末返回一次失败点最新快照，依据该快照自我修正后再继续。结果为 stopped_by_user 时表示用户主动叫停：不要原样重发同一批动作，先重新观察页面快照，必要时询问用户意图。",
    inputSchema: actionsInput,
    wireInputSchema: z
      .object({
        tab_id: browserTabIdSchema,
        actions: z.array(actionWire).min(1).max(20),
      })
      .strict(),
    annotations: mutation,
  },
  {
    name: "browser_tabs",
    domainId: "browser",
    access: "read",
    planExcluded: true,
    description:
      "列出本 Section 拥有的 tab 与用户当前可见 tab，并标明 owned。",
    crossReferences: [
      {
        mentions: ["browser_close"],
        text: "tab 满 10 个时先用本工具查看再 browser_close 腾位。",
      },
    ],
    inputSchema: z.object({}).strict(),
    annotations: read,
  },
  {
    name: "browser_close",
    domainId: "browser",
    access: "mutate",
    planExcluded: true,
    description: "关闭本 Section 拥有的 browser tab。",
    inputSchema: tabInput,
    annotations: mutation,
  },
] as const satisfies readonly BuiltinToolSpec[];
