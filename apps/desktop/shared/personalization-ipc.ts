/**
 * [INPUT]: Depends on zod and shared Agent rear end pickup; Receive the original text, the back end and the previous digest
 * [OUTPUT]: Provides Personalization IPC channel ((list/save/reveal) ‡256KiB limit ‡Instruction file/CAS save for differentiation combined with renderer bridge
 * [POS]: The wire is the source of the universal Agent instruction file shared by the truth source; The absolute path with the original errno is not wearing preload
 */

import { z } from "zod";
import { agentBackendIdSchema } from "./agent-schema";
import type { AgentBackendId } from "./agent-ipc";

export const PERSONALIZATION_BYTE_LIMIT = 256 * 1024;

export const PERSONALIZATION_CHANNEL = {
  list: "personalization:list",
  save: "personalization:save",
  reveal: "personalization:reveal",
} as const;

export type AgentInstructionsErrorCode =
  | "conflict"
  | "too-large"
  | "oversized-file"
  | "symlink-unresolvable"
  | "read-failed"
  | "write-failed";

export type AgentInstructionsFile = Readonly<{
  backend: AgentBackendId;
  displayPath: string;
  /* 软链才有：链接指向的真身。两条路径分成两个字段而不是拼成
     `a → b` 一个字符串——界面要把它们排成两行、复制只复制链接那条，
     压成一句就得在 renderer 上劈箭头，而劈字符串正是契约该替它做掉的事。 */
  linkTarget?: string;
  exists: boolean;
  oversized: boolean;
  /* 只有 oversized 才带：内容没被加载，renderer 无从自算体量，而
     「这个文件到底多大」正是这一态唯一还能说的事实。其余情形下体量
     等于草稿的字节数，renderer 自己数即可，不必让盘面再说一遍。 */
  size?: number;
  content: string | null;
  digest: string | null;
  error?: Exclude<AgentInstructionsErrorCode, "conflict" | "too-large" | "write-failed">;
}>;

export type SaveInstructionsInput = Readonly<{
  backend: AgentBackendId;
  content: string;
  expectedDigest: string | null;
}>;

export type SaveInstructionsResult =
  | { status: "ok"; file: AgentInstructionsFile }
  | {
      status: "conflict";
      current:
        | { oversized: false; content: string; digest: string | null }
        | { oversized: true; content: null; digest: string };
    }
  | {
      status: "error";
      code: Exclude<AgentInstructionsErrorCode, "conflict">;
    };

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/).nullable();

export const saveInstructionsInputSchema = z
  .object({
    backend: agentBackendIdSchema,
    content: z.string().refine(
      (value) => Buffer.byteLength(value, "utf8") <= PERSONALIZATION_BYTE_LIMIT,
      "too-large"
    ),
    expectedDigest: digestSchema,
  })
  .strict();

export type PersonalizationBridgeApi = {
  list(): Promise<AgentInstructionsFile[]>;
  save(input: SaveInstructionsInput): Promise<SaveInstructionsResult>;
  /* 只递 backend，不递路径：绝对路径不穿 preload 这条约束若在这里破例，
     renderer 就成了路径的授权方，而它连自己在编辑哪个真身都不该知道。 */
  reveal(backend: AgentBackendId): Promise<void>;
};
