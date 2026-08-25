/**
 * [INPUT]: Depends on zod and shared ProcessIdentity
 * [OUTPUT]: Provides guardian env name of the channel control, NDJSON binary message schema, exit code table and launch capability shape
 * [POS]: The process boundary agreement of custody; The only thing that the main side runstime and the guardian entry have in common is that neither side has a runtime
 */

import { z } from "zod";

/**
 * guardian spawn 时**只**允许出现这三个变量：控制通道、身份凭据与 nonce。
 * workspace cwd、读写根、backend env 与围栏都是 capability，一律等到
 * `activation-authorized` 之后经控制通道交付（D33/§3.3）。
 */
export const CUSTODY_ENV = {
  socket: "AI_CHAT_CUSTODY_SOCKET",
  token: "AI_CHAT_CUSTODY_TOKEN",
  nonce: "AI_CHAT_CUSTODY_NONCE",
} as const;

/**
 * guardian 自身的退出码。真正的 backend 一旦启动，guardian 的退出码/信号就
 * **原样**变成 backend 的——归因内核（acp-turn 的 exit/close 分工）依赖这一点，
 * 所以下列码只覆盖「backend 从未启动」的那几种死法。
 */
export const GUARDIAN_EXIT = {
  /** 环境缺失或报文违规：guardian 从未取得任何能力 */
  protocol: 70,
  /** 交付 capability 之前控制通道消失：无人可交待，自停 */
  orphaned: 71,
  /** 已交付 capability 但 backend spawn 失败 */
  launchFailed: 72,
  /** main 显式要求下线 */
  standDown: 73,
} as const;

export const processIdentitySchema = z
  .object({
    pid: z.number().int().positive(),
    processGroupId: z.number().int().positive(),
    birthIdentity: z.string().min(1),
    executableIdentity: z.string().min(1),
  })
  .strict();

/** activation 交付的完整 capability；guardian 自己一个字段都不补。 */
export const guardianLaunchSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()),
    cwd: z.string().min(1),
    env: z.record(z.string(), z.string()),
  })
  .strict();

export type GuardianLaunch = z.infer<typeof guardianLaunchSchema>;

/* ── guardian → main ─────────────────────────────────────────── */
export const guardianMessageSchema = z.discriminatedUnion("kind", [
  z
    .object({
      v: z.literal(1),
      kind: z.literal("hello"),
      token: z.string().length(64),
      nonce: z.string().uuid(),
      identity: processIdentitySchema,
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      kind: z.literal("activated"),
      nonce: z.string().uuid(),
      backendPid: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      kind: z.literal("failed"),
      nonce: z.string().uuid(),
      reason: z.string().min(1).max(512),
    })
    .strict(),
]);

export type GuardianMessage = z.infer<typeof guardianMessageSchema>;

/* ── main → guardian ─────────────────────────────────────────── */
export const custodyCommandSchema = z.discriminatedUnion("kind", [
  z
    .object({
      v: z.literal(1),
      kind: z.literal("activate"),
      nonce: z.string().uuid(),
      launch: guardianLaunchSchema,
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      kind: z.literal("stand-down"),
      nonce: z.string().uuid(),
    })
    .strict(),
]);

export type CustodyCommand = z.infer<typeof custodyCommandSchema>;

/** 单行上限：activate 要带完整 env，比工具调用宽，但仍必须有界。 */
export const CUSTODY_LINE_LIMIT = 2 * 1024 * 1024;

export function encodeCustodyLine(value: GuardianMessage | CustodyCommand) {
  return `${JSON.stringify(value)}\n`;
}
