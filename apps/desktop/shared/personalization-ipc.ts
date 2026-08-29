/**
 * [INPUT]: Depends on zod, shared Agent backend ids, and Project id constraints; receives bounded text, file identities, digests, and workspace revisions
 * [OUTPUT]: Provides global and Project-scoped Personalization IPC contracts with 256 KiB limits and two-factor CAS
 * [POS]: Shared wire authority for Agent instruction files; renderer receives display paths and stable error codes, never authorization paths
 */

import { z } from "zod";
import { agentBackendIdSchema } from "./agent-schema";
import type { AgentBackendId } from "./agent-ipc";
import { PROJECT_ID_PATTERN } from "./projects-ipc";

export const PERSONALIZATION_BYTE_LIMIT = 256 * 1024;

export const PERSONALIZATION_CHANNEL = {
  list: "personalization:list",
  save: "personalization:save",
  reveal: "personalization:reveal",
} as const;

export const PROJECT_PERSONALIZATION_CHANNEL = {
  list: "personalization:project:list",
  save: "personalization:project:save",
  reveal: "personalization:project:reveal",
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

export type ProjectInstructionsFileId = "agents" | "claude";

export type ProjectInstructionsErrorCode =
  | AgentInstructionsErrorCode
  | "outside-workspace"
  | "app-managed";

export type ProjectInstructionsFile = Readonly<{
  fileId: ProjectInstructionsFileId;
  readBy: readonly AgentBackendId[];
  displayPath: string;
  linkTarget?: string;
  exists: boolean;
  oversized: boolean;
  size?: number;
  content: string | null;
  digest: string | null;
  error?: Exclude<
    ProjectInstructionsErrorCode,
    "conflict" | "too-large" | "write-failed"
  >;
}>;

export type ProjectInstructionsSnapshot = Readonly<{
  workspaceRevision: number;
  files: readonly ProjectInstructionsFile[];
}>;

export type SaveProjectInstructionsInput = Readonly<{
  projectId: string;
  fileId: ProjectInstructionsFileId;
  content: string;
  expectedDigest: string | null;
  expectedWorkspaceRevision: number;
}>;

export type SaveProjectInstructionsResult =
  | {
      status: "ok";
      file: ProjectInstructionsFile;
      workspaceRevision: number;
    }
  | {
      status: "conflict";
      current:
        | { oversized: false; content: string; digest: string | null }
        | { oversized: true; content: null; digest: string };
      workspaceRevision: number;
    }
  | { status: "workspace-changed"; snapshot: ProjectInstructionsSnapshot }
  | {
      status: "error";
      code: Exclude<ProjectInstructionsErrorCode, "conflict">;
    };

const projectInstructionsFileIdSchema = z.enum(["agents", "claude"]);

export const saveProjectInstructionsInputSchema = z
  .object({
    projectId: z.string().regex(PROJECT_ID_PATTERN),
    fileId: projectInstructionsFileIdSchema,
    content: z.string().refine(
      (value) => Buffer.byteLength(value, "utf8") <= PERSONALIZATION_BYTE_LIMIT,
      "too-large"
    ),
    expectedDigest: digestSchema,
    expectedWorkspaceRevision: z.number().int().nonnegative(),
  })
  .strict();

export const projectInstructionsTargetSchema = z
  .object({
    projectId: z.string().regex(PROJECT_ID_PATTERN),
    fileId: projectInstructionsFileIdSchema,
  })
  .strict();

export type ProjectPersonalizationBridgeApi = {
  list(projectId: string): Promise<ProjectInstructionsSnapshot>;
  save(
    input: SaveProjectInstructionsInput
  ): Promise<SaveProjectInstructionsResult>;
  reveal(projectId: string, fileId: ProjectInstructionsFileId): Promise<void>;
};
