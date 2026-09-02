/**
 * [INPUT]: Depends on DurableJson/quarantineDurableFile, shared AppGenerationBuildOperation/AppDomainIdentity, normalized extensionRequirements and Base GUI capability requests
 * [OUTPUT]: Provides AppGenerationBuildLedger; staging is freezing the extension/Base GUI declaration, build-before-participant fsync, monophonic checkpoint/phase, abort tombstone, retired identity, query, non-terminal recovery of the listing and the air conditioning cold start after the breakdown/disconnection
 * [POS]: The generation build neutral durable monograph of apps; Participant can only return checkpoint and cannot directly promote AppStore
 */

import { join } from "node:path";
import { z } from "zod";
import type {
  AppGenerationBuildCheckpoint,
  AppGenerationBuildOperation,
} from "../../../shared/app-lifecycle";
import type { AppDomainIdentity } from "../../../shared/apps-ipc";
import {
  DurableFileCorruptionError,
  DurableJson,
  quarantineDurableFile,
} from "../persistence/durable-json";

const domainSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("no-data"), appKind: z.enum(["static", "server"]) }).strict(),
  z.object({
    kind: z.literal("base"),
    domain: z.object({ kind: z.literal("ordinary") }).strict(),
  }).strict(),
]);
const checkpointSchema = z.object({
  kind: z.enum(["app-extension", "base-gui", "server-data-cutover"]),
  operationId: z.string().min(1),
  state: z.enum(["prepared", "committed", "aborted", "needs-attention"]),
}).strict();
const declarationSchema = z.object({
  declaredComponentIdentity: z.string().min(1),
  packageDigest: z.string().min(1).optional(),
  versionRange: z.string().min(1).optional(),
  required: z.boolean(),
  requestedConfig: z.record(z.string(), z.unknown()).optional(),
  source: z.object({
    repoUrl: z.string().min(1),
    ref: z.string().min(1).optional(),
  }).strict().optional(),
}).strict();
const operationSchema = z.object({
  generationBuildId: z.string().min(1),
  appId: z.string().regex(/^[a-z0-9]{10}$/),
  appGenerationId: z.string().min(1),
  expectedActiveGenerationId: z.string().min(1).nullable(),
  phase: z.enum(["staging", "generation-committed", "ready-to-promote", "promoted", "aborted", "needs-attention"]),
  revision: z.number().int().nonnegative(),
  normalizedDomainIdentity: domainSchema,
  runtime: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }).strict(),
    z.object({ kind: z.literal("server"), dataEpochId: z.string().min(1) }).strict(),
  ]),
  extensionRequirements: z.array(declarationSchema).default([]),
  baseGuiCapabilityRequest: z.object({
    requestedCapabilities: z
      .array(z.enum(["row-insert", "row-patch", "row-delete", "attachment-read", "workspace-read"]))
      .max(5),
    requestedHostActions: z.array(z.enum(["compose-text", "file.export"])).max(2).default([]),
    requestedCapabilityScopes: z
      .object({ workspaceRead: z.literal("design/").optional() })
      .strict()
      .default({}),
    contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).transform(
      (value) => value as `sha256:${string}`
    ),
  }).strict().optional(),
  checkpoints: z.array(checkpointSchema),
}).strict();
const fileSchema = z.object({
  schemaVersion: z.literal(3),
  operations: z.array(operationSchema),
  retiredBuildIds: z.array(z.string().min(1)),
}).strict();
type File = z.infer<typeof fileSchema>;

const phaseRank: Record<AppGenerationBuildOperation["phase"], number> = {
  staging: 0,
  "generation-committed": 1,
  "ready-to-promote": 2,
  "needs-attention": 2,
  promoted: 3,
  aborted: 3,
};

export class AppGenerationBuildLedger {
  private readonly file: DurableJson<File>;

  constructor(userData: string) {
    this.file = new DurableJson(
      join(userData, "apps", "generation-builds.json"),
      fileSchema,
      () => ({ schemaVersion: 3, operations: [], retiredBuildIds: [] })
    );
  }

  async initialize() {
    try {
      await this.file.initialize();
    } catch (cause) {
      if (!(cause instanceof DurableFileCorruptionError)) throw cause;
      /* 旧 schema/损坏不阻断启动：隔离原件后从空账本重走同一初始化路径
         （≡ 冷启动）。后果如实——未终结的 generation build 记录清零，对应
         App 需重装；这比让整个 main 起不来便宜得多，隔离件留证可追溯。 */
      console.warn(
        `[apps] generation build 账本无法读取，已隔离旧版数据（备份至 ${this.file.filePath}.quarantine-*），Base App 请重装`,
        cause
      );
      await quarantineDurableFile(this.file.filePath);
      await this.file.initialize();
    }
  }

  listNonTerminal(appId?: string) {
    return this.file.snapshot().operations.filter(
      (operation) =>
        (!appId || operation.appId === appId) &&
        operation.phase !== "promoted" &&
        operation.phase !== "aborted"
    ) as AppGenerationBuildOperation[];
  }

  isRetired(generationBuildId: string) {
    return this.file.snapshot().retiredBuildIds.includes(generationBuildId);
  }

  begin(input: {
    generationBuildId: string;
    appId: string;
    appGenerationId: string;
    expectedActiveGenerationId: string | null;
    domainIdentity: AppDomainIdentity;
    runtime: AppGenerationBuildOperation["runtime"];
    extensionRequirements?: AppGenerationBuildOperation["extensionRequirements"];
    baseGuiCapabilityRequest?: AppGenerationBuildOperation["baseGuiCapabilityRequest"];
  }) {
    return this.file.mutate((state) => {
      if (state.retiredBuildIds.includes(input.generationBuildId)) {
        throw new Error("generationBuildId 已永久退役");
      }
      const existing = state.operations.find(
        (operation) => operation.generationBuildId === input.generationBuildId
      );
      if (existing) return existing;
      const operation = operationSchema.parse({
        generationBuildId: input.generationBuildId,
        appId: input.appId,
        appGenerationId: input.appGenerationId,
        expectedActiveGenerationId: input.expectedActiveGenerationId,
        phase: "staging",
        revision: 0,
        normalizedDomainIdentity: input.domainIdentity,
        runtime: input.runtime,
        extensionRequirements: input.extensionRequirements ?? [],
        ...(input.baseGuiCapabilityRequest
          ? { baseGuiCapabilityRequest: input.baseGuiCapabilityRequest }
          : {}),
        checkpoints: [],
      });
      state.operations.push(operation);
      return operation;
    });
  }

  checkpoint(
    generationBuildId: string,
    expectedRevision: number,
    checkpoint: AppGenerationBuildCheckpoint
  ) {
    return this.file.mutate((state) => {
      const operation = requireOperation(state, generationBuildId);
      assertMutable(operation, expectedRevision);
      const index = operation.checkpoints.findIndex(
        (item) => item.kind === checkpoint.kind
      );
      if (index >= 0) operation.checkpoints[index] = checkpoint;
      else operation.checkpoints.push(checkpoint);
      operation.revision += 1;
      return operation;
    });
  }

  advance(
    generationBuildId: string,
    expectedRevision: number,
    phase: AppGenerationBuildOperation["phase"]
  ) {
    return this.file.mutate((state) => {
      const operation = requireOperation(state, generationBuildId);
      assertMutable(operation, expectedRevision);
      if (phaseRank[phase] < phaseRank[operation.phase]) {
        throw new Error("generation build phase 不可回退");
      }
      operation.phase = phase;
      operation.revision += 1;
      if (phase === "promoted" || phase === "aborted") {
        state.retiredBuildIds.push(generationBuildId);
      }
      return operation;
    });
  }
}

function requireOperation(state: File, generationBuildId: string) {
  const operation = state.operations.find(
    (item) => item.generationBuildId === generationBuildId
  );
  if (!operation) throw new Error("generation build 不存在");
  return operation;
}

function assertMutable(
  operation: File["operations"][number],
  expectedRevision: number
) {
  if (operation.revision !== expectedRevision) throw new Error("BUILD_REVISION_MISMATCH");
  if (operation.phase === "promoted" || operation.phase === "aborted") {
    throw new Error("generation build 已终结");
  }
}
