/**
 * [INPUT]: Depends on zod, node:crypto SHA-256, and the shared five-locale enum
 * [OUTPUT]: Provides current and migration-only LifecycleIntent schemas for seven saga inputs (decoding normalizes a terminal intent's retired phase to its kind's last phase, while a non-terminal unknown phase stays fail-closed), the shared monotonic phase comparison (phaseReached/reached), frozen Studio-only install authorization, locale, tombstone, stableInputHash, provenance, fulfillment, and consent claims
 * [POS]: The type truth source of the lifecycle domain, covenant v3, second paragraph of the machine image; consumed by intent-store/admission-gate in a single direction
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { APP_LOCALES } from "../../../shared/i18n/locale";

/* ── phase 单调枚举:首档恒为 "proposed"(身份已定、尚未准入——R7/P0-1:
 * 落盘与取 gate 之间存在崩溃窗口,重启后必须能区分「已准入」与「仅提案」,
 * 否则两个提案态互相看作 rival 而永久互锁),第二档起为准入后的推进序。 ── */
export const INTENT_PHASES = {
  "save-as-app": [
    "proposed",
    "admitted",
    "record-created",
    "project-ensured",
    "chat-migrated",
    "promotion-created",
    "promoted",
    "skill-turn-enqueued",
    "rollback-started",
    "rollback-chat-restored",
    "rollback-project-removed",
    "rollback-shell-removed",
  ],
  "base-promotion": ["proposed", "pending", "project-written"],
  "app-delete": [
    "proposed",
    "admitted",
    "admission-closed",
    "turns-drained",
    "chats-settled",
    "base-settled",
    "project-settled",
    "builds-settled",
    "generations-retired",
    "grants-settled",
    "data-settled",
  ],
  "chat-slot": ["proposed", "allocated"],
  "base-import": ["proposed", "delivered", "project-ensured", "base-seeded"],
  "preset-install": ["proposed", "delivered", "project-ensured", "base-seeded"],
  "share-publish": [
    "proposed",
    "prepared",
    "remote-created",
    "pushed",
    "recorded",
  ],
} as const satisfies Record<string, readonly [string, ...string[]]>;

export type LifecycleKind = keyof typeof INTENT_PHASES;
export const PROPOSED_PHASE = "proposed";

/* ── phase 单调序只有一个裁判:各 saga 问「跑到哪了」,不各自抄一份序表。 ── */
export function phaseReached(
  kind: LifecycleKind,
  phase: string,
  target: string
) {
  const phases = INTENT_PHASES[kind] as readonly string[];
  return phases.indexOf(phase) >= phases.indexOf(target);
}

export function reached(
  kind: LifecycleKind,
  intent: { phase: string },
  target: string
) {
  return phaseReached(kind, intent.phase, target);
}

const kindSchema = z.enum(
  Object.keys(INTENT_PHASES) as [LifecycleKind, ...LifecycleKind[]]
);

/* ── input:按 kind 的判别 schema(strict)。spike 钉死三个 kind 的结构;
 * import/preset 至少要求可推导 claims 的字段面在各案实施时收紧。 ── */
const saveAsAppInput = z
  .object({
    chatId: z.string().min(1),
    name: z.string().min(1).max(120),
    icon: z.string().min(1).max(16),
    locale: z.enum(APP_LOCALES).optional(),
  })
  .strict();
const basePromotionInput = z
  .object({ chatId: z.string().min(1), projectId: z.string().min(1) })
  .strict();
const chatSlotInput = z
  .object({
    appId: z.string().min(1),
    role: z.enum(["edit", "use"]),
    mode: z.enum(["reuse", "new"]),
  })
  .strict();
const appDeleteInput = z
  .object({
    appId: z.string().min(1),
    mode: z.enum(["cascade", "retain-data"]),
  })
  .strict();
const openInput = z.record(z.string(), z.unknown());
const importInputFields = {
  sourceRef: z.string().min(1),
  confirmedDigest: z.string().regex(/^[0-9a-f]{64}$/),
  packageRoot: z.string().min(1),
  agent: z.enum(["codex", "claude", "kimi", "opencode"]),
  extensionFulfillment: z.array(z.object({
    declaredComponentIdentity: z.string().min(1),
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("global") }).strict(),
      z.object({
        kind: z.literal("project"),
        projectId: z.string().min(1),
      }).strict(),
    ]),
    projectLifecycleRevision: z.number().int().positive().nullable(),
    scopeRevision: z.number().int().nonnegative(),
    repoUrl: z.string().min(1),
    requestedRef: z.string(),
    resolvedCommit: z.string().min(1),
    contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    capabilityDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }).strict()).default([]),
  authorization: z
    .object({
      scope: z.literal("studio-only"),
      decision: z.literal("approve-requested"),
    })
    .strict(),
};
const baseImportInput = z
  .object({ origin: z.literal("github"), ...importInputFields })
  .strict();
const presetInstallInput = z
  .object({
    origin: z.literal("preset"),
    ...importInputFields,
    presetId: z.string().regex(/^[a-z][a-z0-9-]{1,38}$/),
    resolvedPin: z.string().regex(/^[0-9a-f]{40}$/),
    channel: z.enum(["release", "dev"]),
  })
  .strict();

export const INTENT_INPUT_SCHEMAS: Record<LifecycleKind, z.ZodType> = {
  "save-as-app": saveAsAppInput,
  "base-promotion": basePromotionInput,
  "chat-slot": chatSlotInput,
  "app-delete": appDeleteInput,
  "base-import": baseImportInput,
  "preset-install": presetInstallInput,
  "share-publish": openInput,
};

const errorSchema = z
  .object({ code: z.string().min(1), message: z.string() })
  .strict();

const terminalSchema = z
  .object({
    status: z.enum(["done", "rolled-back"]),
    receipt: z.record(z.string(), z.unknown()).optional(),
    error: errorSchema.optional(),
    settledAt: z.number().int().nonnegative(),
  })
  .strict()
  .refine((t) => t.status !== "rolled-back" || t.error !== undefined, {
    message: "rolled-back 终态必须携带结构化 error",
  });

const lifecycleIntentEnvelopeSchema = z
  .object({
    intentId: z.string().min(1),
    parentIntentId: z.string().min(1).optional(),
    requestId: z.string().min(1),
    kind: kindSchema,
    input: z.record(z.string(), z.unknown()),
    inputHash: z.string().length(64),
    /** 资源占用集,创建时冻结、此后不可变(R7/P0-2/P0-3);admission 互斥按交集判定。 */
    claims: z.array(z.string().min(1)).min(1).readonly(),
    /** 身份分配产物(如 appId),创建时冻结不可变;claims 由它推导(R8/P0-3:与可变 recoveryState 分离)。 */
    allocated: z.record(z.string(), z.unknown()),
    recoveryState: z.record(z.string(), z.unknown()),
    phase: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    terminal: terminalSchema.optional(),
  })
  .strict()
  .superRefine((intent, ctx) => {
    const phases: readonly string[] = INTENT_PHASES[intent.kind];
    if (!phases.includes(intent.phase)) {
      ctx.addIssue({
        code: "custom",
        message: `kind ${intent.kind} 不存在 phase ${intent.phase}`,
      });
    }
  });

/* ── 退役阶段归一(只对终态):阶段名册允许演进——app-delete 的 placements-*
 * 已随编排收束而退役——但已完成的意图不该有能力阻断启动,终态语义不变,
 * 归一到该 kind 的末档即可。非终态的未知 phase 仍是真损坏(待跑的工作停在
 * 无人认识的状态,续跑必然越权),照旧 fail-closed。 ── */
function retireUnknownPhase(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const row = value as Record<string, unknown>;
  const phases: readonly string[] | undefined =
    INTENT_PHASES[row.kind as LifecycleKind];
  if (!phases || !row.terminal || phases.includes(row.phase as string)) {
    return value;
  }
  return { ...row, phase: phases[phases.length - 1] };
}

const decodedIntentEnvelopeSchema = z.preprocess(
  retireUnknownPhase,
  lifecycleIntentEnvelopeSchema
);

/** v1 迁移只用的信封 schema：验证事务骨架，不把历史 input 视为当前授权。 */
export const legacyLifecycleIntentSchema = decodedIntentEnvelopeSchema;

export const lifecycleIntentSchema = decodedIntentEnvelopeSchema.superRefine(
  (intent, ctx) => {
    const parsed = INTENT_INPUT_SCHEMAS[intent.kind].safeParse(intent.input);
    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        message: `kind ${intent.kind} 的 input 不合判别 schema`,
      });
    }
  }
);

export type LifecycleIntent = z.infer<typeof lifecycleIntentSchema>;
export type LegacyLifecycleIntent = z.infer<
  typeof legacyLifecycleIntentSchema
>;

/* ── 终态压缩后的轻量墓碑:幂等查询永远可答;error 一并保留(R7/P1-9)。 ── */
export const intentTombstoneSchema = z
  .object({
    kind: kindSchema,
    requestId: z.string().min(1),
    intentId: z.string().min(1),
    inputHash: z.string().length(64),
    status: z.enum(["done", "rolled-back"]),
    receipt: z.record(z.string(), z.unknown()).optional(),
    error: errorSchema.optional(),
  })
  .strict();
export type IntentTombstone = z.infer<typeof intentTombstoneSchema>;

/* ── 文件级不变量(R7/P1-11):intentId 全局唯一、(kind, requestId) 全局唯一。 ── */
export function assertFileInvariants(
  intents: readonly LifecycleIntent[],
  tombstones: readonly IntentTombstone[]
): void {
  const ids = new Set<string>();
  const requests = new Set<string>();
  for (const row of [...intents, ...tombstones]) {
    if (ids.has(row.intentId)) {
      throw new Error(`intentId 重复:${row.intentId}`);
    }
    ids.add(row.intentId);
    const key = `${row.kind}\u0000${row.requestId}`;
    if (requests.has(key)) {
      throw new Error(`(kind, requestId) 重复:${row.kind}/${row.requestId}`);
    }
    requests.add(key);
  }
}

/* ── 幂等哈希:只对不可变 input,键序规范化(契约 R5/P0-8)。 ── */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  if (value === undefined) return '"\\u0000undefined"';
  if (typeof value === "number" && Number.isNaN(value)) return '"\\u0000nan"';
  return JSON.stringify(value) ?? '"\\u0000undefined"';
}

export function stableInputHash(input: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

/* ── 资源占用集推导(R7/P0-2 冲突矩阵):创建时一次计算并冻结。
 * chat/app/project 三维;allocate 产物(如 import 的 appId)必须在创建前就绪。 ── */
export function claimsOf(
  kind: LifecycleKind,
  input: Record<string, unknown>,
  allocated: Record<string, unknown>
): string[] {
  const chat = str(input.chatId);
  const app = str(allocated.appId) ?? str(input.appId);
  const project = str(allocated.projectId) ?? str(input.projectId);
  const need = (
    label: string,
    value: string | undefined,
    dim: string
  ): string => {
    if (!value) {
      throw new Error(
        `kind ${kind} 的 claim 闭包缺 ${dim} 维度(${label})——身份必须在创建前分配(R8 闭包完整性)`
      );
    }
    return `${dim}:${value}`;
  };
  switch (kind) {
    case "save-as-app":
      /* 闭包含未来子 promotion 的 project(R8:否则同 project 的另一 promotion 可穿透)。 */
      return [
        need("input.chatId", chat, "chat"),
        need("allocated.appId", app, "app"),
        need("allocated.projectId", project, "project"),
      ];
    case "base-promotion":
      return [
        need("input.chatId", chat, "chat"),
        need("input.projectId", project, "project"),
      ];
    case "app-delete": {
      /* 删除触及既有 Project（cascade 连库删）：占上 project 维才挡得住并发
       * base-promotion 交错；壳已无 Project 时只占 app 维（allocate 回填空串）。 */
      const claims = [need("input.appId", app, "app")];
      if (project) claims.push(`project:${project}`);
      return claims;
    }
    case "chat-slot":
    case "share-publish":
      return [need("input.appId", app, "app")];
    case "base-import":
    case "preset-install":
      /* R8 闭包完整性：交付会创建并写入预分配的 Project。 */
      return [
        need("allocated.appId", app, "app"),
        need("allocated.projectId", project, "project"),
      ];
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
