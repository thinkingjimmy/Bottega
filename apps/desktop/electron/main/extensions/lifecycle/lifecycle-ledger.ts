/**
 * [INPUT]: Depends on DurableJson, zod, canonical Product scope, and Extension generation/source/admission contracts
 * [OUTPUT]: Provides exact-empty v1 migration, scope-frozen Extension lifecycle receipts, atomic authorization snapshots, pre-allocated identities, and phase/App checkpoints
 * [POS]: Durable single writer for Extension lifecycle; recovery trusts the frozen owner/lifecycle/scope CAS receipt rather than renderer input or filesystem guesses
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  SHA256_DIGEST_IDENTITY_PATTERN,
  type ExtensionPackageGenerationRef,
  type ExtensionLifecycleStep,
  type Sha256Digest,
} from "../../../../shared/extensions-ipc";
import {
  sameProductResourceScope as sameScope,
  type ProductResourceScope,
} from "../../../../shared/product-resource-scope";
import type { ExtensionAdapterId } from "../admission";
import type { ExtensionPackageAdmission } from "../manifest-adapter";
import type { ExtensionSourceProvenance } from "../registry-store";
import {
  DurableJson,
  type DurableReplaceFileFaults,
} from "../../persistence/durable-json";

/* ============================================================
 * 为什么必须先落账再动文件系统。
 *
 * 「rename final → 再写 registry」把身份交给了文件系统：崩在两步之间时，恢复
 * 只能靠「目录在不在」猜意图，而重放又会 randomUUID 出第二个 generation id，
 * 于是同一次安装留下两代。这里反过来——身份在 staged 那一刻就预分配并 fsync，
 * 之后每一步都按 id 幂等：重放要么命中已存在的那一代，要么用同一个 id 补写。
 * ============================================================ */

const digestSchema = z
  .string()
  .regex(SHA256_DIGEST_IDENTITY_PATTERN)
  .transform((value) => value as Sha256Digest);
const identitySchema = z.string().regex(SHA256_DIGEST_IDENTITY_PATTERN);

const generationRefSchema = z
  .object({
    packageGenerationId: z.string().min(1),
    recordDigest: digestSchema,
  })
  .strict();

const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z
    .object({
      kind: z.literal("project"),
      projectId: z.string().regex(/^[A-Za-z0-9_-]{10,64}$/),
    })
    .strict(),
]);

const sourceSchema = z
  .object({
    normalizedUrl: z.string().min(1),
    requestedRef: z.string(),
    resolvedCommit: z.string().min(1),
    subdirectory: z.string(),
    treeDigest: digestSchema,
    fetchedAt: z.number().int().nonnegative(),
  })
  .strict();

const diagnosticSchema = z
  .object({
    severity: z.enum(["report", "error"]),
    scope: z.enum(["package", "skills", "mcp", "component"]),
    code: z.literal("unsupported-version").optional(),
    path: z.string(),
    message: z.string(),
  })
  .strict();

const skillSchema = z
  .object({
    kind: z.literal("skill"),
    componentId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    skillFile: z.string().min(1),
  })
  .strict();

const mcpSchema = z
  .object({
    kind: z.literal("mcp-server"),
    componentId: z.string().min(1),
    serverId: z.string().min(1),
    config: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("stdio"),
          command: z.string().min(1),
          args: z.array(z.string()),
          env: z.record(z.string(), z.string()),
          cwd: z.string().min(1).optional(),
        })
        .strict(),
      z
        .object({
          type: z.enum(["streamable-http", "sse"]),
          url: z.string().min(1),
          headers: z.record(z.string(), z.string()),
        })
        .strict(),
    ]),
  })
  .strict();

const admissionSchema: z.ZodType<ExtensionPackageAdmission> = z
  .object({
    adapterId: z.enum(["agent-plugins-1.0.0", "skill-repo-1.0.0"]),
    pluginRoot: z.string().min(1),
    manifest: z.record(z.string(), z.unknown()),
    unknownManifestFields: z.array(z.string()),
    components: z.array(z.union([skillSchema, mcpSchema])),
    diagnostics: z.array(diagnosticSchema),
    valid: z.boolean(),
    containsStdio: z.boolean(),
  })
  .strict();

const authorizedInstallSchema = z
  .object({
    adapterId: z.enum(["agent-plugins-1.0.0", "skill-repo-1.0.0"]),
    componentNamespace: z.string().min(1),
    scope: scopeSchema,
    sourceIdentity: identitySchema,
    expectedProjectLifecycleRevision: z.number().int().positive().nullable(),
    expectedScopeRevision: z.number().int().nonnegative(),
    source: sourceSchema,
    admission: admissionSchema,
    evidence: z
      .object({
        schemaDigest: digestSchema,
        validatorFixtureDigest: digestSchema,
      })
      .strict(),
    displayName: z.string().min(1),
    expectedActiveGenerationRef: generationRefSchema.nullable(),
    preserveEnabled: z.boolean(),
    migrateAppIds: z.array(z.string().min(1)),
    migratedAppIds: z.array(z.string().min(1)),
  })
  .strict();

const operationSchema = z
  .object({
    operationId: z.string().min(1),
    kind: z.enum(["install", "update", "disable", "uninstall"]),
    installIdentity: identitySchema,
    scope: scopeSchema,
    sourceIdentity: identitySchema,
    expectedProjectLifecycleRevision: z.number().int().positive().nullable(),
    expectedScopeRevision: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    phase: z.enum(["staged", "sealing", "converging", "completed", "aborted"]),
    identities: z
      .object({
        packageGenerationId: z.string().min(1),
        pluginDataEpochId: z.string().min(1).nullable(),
        sourceEpochId: z.string().min(1).nullable(),
      })
      .strict(),
    contentDigest: digestSchema.nullable(),
    /* null = 尚未授权，可丢弃；非 null = 用户已确认，恢复必须重放到完成。 */
    authorizedInstall: authorizedInstallSchema.nullable().default(null),
    installAuthorizationState: z.enum(["none", "prepared", "committed"]),
    completedSteps: z.array(z.string().min(1)),
    blocked: z
      .object({ code: z.string().min(1), message: z.string() })
      .strict()
      .nullable(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

const DISABLE_STEPS: readonly ExtensionLifecycleStep[] = [
  "product-sessions-drained",
  "projection-binding-revoked",
  "shared-artifacts-released",
  "discovery-cache-invalidated",
];
const UNINSTALL_STEPS: readonly ExtensionLifecycleStep[] = [
  "durable-references-resolved",
  "runtime-custody-drained",
  "package-generations-removed",
  "package-bytes-collected",
];

const ledgerSchema = z
  .object({
    schemaVersion: z.literal(3),
    operations: z.array(operationSchema),
  })
  .strict()
  .superRefine((ledger, context) => {
    const operationIds = new Set<string>();
    const generationIds = new Set<string>();
    const issue = (index: number, path: string[], message: string) =>
      context.addIssue({
        code: "custom",
        path: ["operations", index, ...path],
        message,
      });
    for (const [index, operation] of ledger.operations.entries()) {
      if (operationIds.has(operation.operationId)) {
        issue(index, ["operationId"], "operationId 必须唯一");
      }
      operationIds.add(operation.operationId);
      if (generationIds.has(operation.identities.packageGenerationId)) {
        issue(index, ["identities", "packageGenerationId"], "预分配 generation id 必须唯一");
      }
      generationIds.add(operation.identities.packageGenerationId);
      const projectRevisionValid = operation.scope.kind === "global"
        ? operation.expectedProjectLifecycleRevision === null
        : operation.expectedProjectLifecycleRevision !== null;
      if (!projectRevisionValid) {
        issue(index, ["expectedProjectLifecycleRevision"], "Project lifecycle revision 与 scope 不一致");
      }
      const isInstall = operation.kind === "install" || operation.kind === "update";
      const allowedSteps = operation.kind === "disable"
        ? DISABLE_STEPS
        : operation.kind === "uninstall"
          ? UNINSTALL_STEPS
          : [];
      const completed = new Set(operation.completedSteps);
      if (
        completed.size !== operation.completedSteps.length ||
        operation.completedSteps.some((step) => !allowedSteps.includes(step as ExtensionLifecycleStep))
      ) {
        issue(index, ["completedSteps"], "completed steps 必须唯一且属于 operation kind");
      }
      if (operation.phase === "staged" && operation.completedSteps.length > 0) {
        issue(index, ["completedSteps"], "staged operation 不得提前完成 convergence step");
      }
      if (
        operation.phase === "completed" &&
        (completed.size !== allowedSteps.length ||
          allowedSteps.some((step) => !completed.has(step)))
      ) {
        issue(index, ["completedSteps"], "completed lifecycle 必须精确覆盖全部 required steps");
      }
      if (!isInstall) {
        if (
          operation.authorizedInstall !== null ||
          operation.installAuthorizationState !== "none" ||
          operation.contentDigest !== null ||
          operation.identities.pluginDataEpochId !== null ||
          operation.identities.sourceEpochId !== null ||
          operation.phase === "sealing"
        ) {
          issue(index, [], "disable/uninstall 不得携带 install authorization/epoch/content");
        }
        continue;
      }
      if (operation.completedSteps.length > 0) {
        issue(index, ["completedSteps"], "install/update 不得携 convergence steps");
      }
      if (operation.contentDigest === null || operation.phase === "converging") {
        issue(index, [], "install/update 必须携 content digest 且不得进入 converging");
      }
      const replay = operation.authorizedInstall;
      if (operation.installAuthorizationState === "none") {
        if (replay !== null || !["staged", "aborted"].includes(operation.phase)) {
          issue(index, ["installAuthorizationState"], "none 只允许未授权 staged/aborted");
        }
        continue;
      }
      if (!replay) {
        issue(index, ["authorizedInstall"], "prepared/committed 必须携授权快照");
        continue;
      }
      const ownerMatches = sameScope(operation.scope, replay.scope) &&
        operation.sourceIdentity === replay.sourceIdentity &&
        operation.expectedProjectLifecycleRevision ===
          replay.expectedProjectLifecycleRevision &&
        operation.expectedScopeRevision === replay.expectedScopeRevision;
      if (!ownerMatches) {
        issue(index, ["authorizedInstall"], "授权快照 owner/CAS 必须与 operation 一致");
      }
      if (
        (operation.kind === "install") !==
          (replay.expectedActiveGenerationRef === null)
      ) {
        issue(index, ["authorizedInstall", "expectedActiveGenerationRef"], "install/update active baseline 不一致");
      }
      if (
        (replay.admission.containsStdio && !operation.identities.pluginDataEpochId) ||
        (!replay.admission.containsStdio && operation.identities.pluginDataEpochId)
      ) {
        issue(index, ["identities", "pluginDataEpochId"], "PLUGIN_DATA epoch 与 admission 不一致");
      }
      if (
        operation.identities.sourceEpochId !== null &&
        (operation.kind !== "update" || replay.expectedActiveGenerationRef === null)
      ) {
        issue(index, ["identities", "sourceEpochId"], "source epoch 只属于 stdio update baseline");
      }
      if (
        operation.installAuthorizationState === "prepared" &&
        operation.phase !== "staged"
      ) {
        issue(index, ["phase"], "prepared authorization 只能停在 staged");
      }
      if (
        operation.installAuthorizationState === "committed" &&
        !["sealing", "completed", "aborted"].includes(operation.phase)
      ) {
        issue(index, ["phase"], "committed authorization phase 非法");
      }
    }
  });

const emptyLegacyLedgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    operations: z.array(z.never()).length(0),
  })
  .strict();

function migrateEmptyLegacyLedger(raw: unknown) {
  if (!emptyLegacyLedgerSchema.safeParse(raw).success) return undefined;
  return { schemaVersion: 3 as const, operations: [] };
}

export type ExtensionLifecycleOperation = z.infer<typeof operationSchema>;
export type ExtensionLifecycleKind = ExtensionLifecycleOperation["kind"];
export type ExtensionLifecyclePhase = ExtensionLifecycleOperation["phase"];

export type AuthorizedExtensionInstall = Readonly<{
  adapterId: ExtensionAdapterId;
  componentNamespace: string;
  scope: ProductResourceScope;
  sourceIdentity: string;
  expectedProjectLifecycleRevision: number | null;
  expectedScopeRevision: number;
  source: ExtensionSourceProvenance;
  admission: ExtensionPackageAdmission;
  evidence: Readonly<{
    schemaDigest: Sha256Digest;
    validatorFixtureDigest: Sha256Digest;
  }>;
  displayName: string;
  expectedActiveGenerationRef: ExtensionPackageGenerationRef | null;
  preserveEnabled: boolean;
  migrateAppIds: readonly string[];
}>;

export type StageLifecycleInput = Readonly<{
  kind: ExtensionLifecycleKind;
  installIdentity: string;
  scope: ProductResourceScope;
  sourceIdentity: string;
  expectedProjectLifecycleRevision: number | null;
  expectedScopeRevision: number;
  contentDigest?: Sha256Digest;
  /** 含 stdio 的代必须在 staged 就定下 epoch 身份，seal 前才可能创建/恢复它 */
  pluginDataEpochId?: string;
  /** 更新时的源 epoch：快照失败即 block，绝不退回 `dataBinding=none` */
  sourceEpochId?: string;
}>;

const TERMINAL: readonly ExtensionLifecyclePhase[] = ["completed", "aborted"];

export class ExtensionLifecycleLedger {
  private readonly file: DurableJson<z.infer<typeof ledgerSchema>>;

  constructor(userData: string, faults: DurableReplaceFileFaults = {}) {
    this.file = new DurableJson(
      join(userData, "agent-extensions", "lifecycle.json"),
      ledgerSchema,
      () => ({ schemaVersion: 3 as const, operations: [] }),
      faults
    );
  }

  get filePath() {
    return this.file.filePath;
  }

  initialize() {
    return this.file.initialize(migrateEmptyLegacyLedger);
  }

  /** 预分配身份并 fsync：此后每一步都能按 id 幂等重放。 */
  stage(input: StageLifecycleInput) {
    return this.file.mutate((state) => {
      const operation: ExtensionLifecycleOperation = {
        operationId: randomUUID(),
        kind: input.kind,
        installIdentity: input.installIdentity,
        scope: structuredClone(input.scope),
        sourceIdentity: input.sourceIdentity,
        expectedProjectLifecycleRevision: input.expectedProjectLifecycleRevision,
        expectedScopeRevision: input.expectedScopeRevision,
        revision: 0,
        phase: "staged",
        identities: {
          packageGenerationId: randomUUID(),
          pluginDataEpochId: input.pluginDataEpochId ?? null,
          sourceEpochId: input.sourceEpochId ?? null,
        },
        contentDigest: input.contentDigest ?? null,
        authorizedInstall: null,
        installAuthorizationState: "none",
        completedSteps: [],
        blocked: null,
        createdAt: Date.now(),
      };
      state.operations.push(operation);
      return operation;
    });
  }

  /** First persist the full authorization intent; Registry reservation bridges stores. */
  prepareInstallAuthorization(
    operationId: string,
    expectedRevision: number,
    replay: AuthorizedExtensionInstall
  ) {
    return this.file.mutate((state) => {
      const operation = requireOperation(state.operations, operationId);
      if (
        operation.installAuthorizationState !== "none" &&
        operation.authorizedInstall
      ) {
        return operation;
      }
      if (operation.kind !== "install" && operation.kind !== "update") {
        throw new Error("只有 install/update 可写入授权快照");
      }
      if (operation.phase !== "staged") {
        throw conflict("扩展安装授权相位已变化");
      }
      assertRevision(operation, expectedRevision);
      operation.revision += 1;
      operation.authorizedInstall = authorizedInstallSchema.parse({
        ...structuredClone(replay),
        migrateAppIds: [...new Set(replay.migrateAppIds)].sort(),
        migratedAppIds: [],
      });
      operation.installAuthorizationState = "prepared";
      operation.blocked = null;
      return operation;
    });
  }

  authorizeInstall(operationId: string, expectedRevision: number) {
    return this.file.mutate((state) => {
      const operation = requireOperation(state.operations, operationId);
      if (
        operation.phase === "sealing" &&
        operation.installAuthorizationState === "committed" &&
        operation.authorizedInstall
      ) {
        return operation;
      }
      if (
        operation.phase !== "staged" ||
        operation.installAuthorizationState !== "prepared" ||
        !operation.authorizedInstall
      ) {
        throw conflict("扩展安装授权尚未 prepared 或相位已变化");
      }
      assertRevision(operation, expectedRevision);
      operation.revision += 1;
      operation.phase = "sealing";
      operation.installAuthorizationState = "committed";
      operation.blocked = null;
      return operation;
    });
  }

  /** App 迁移的逐项 checkpoint；重复记录不推高 revision。 */
  recordAppMigration(operationId: string, appId: string) {
    return this.file.mutate((state) => {
      const operation = requireOperation(state.operations, operationId);
      const replay = operation.authorizedInstall;
      if (!replay?.migrateAppIds.includes(appId)) {
        throw new Error("App 不在本次扩展迁移授权名单中");
      }
      if (!replay.migratedAppIds.includes(appId)) {
        replay.migratedAppIds.push(appId);
        replay.migratedAppIds.sort();
        operation.revision += 1;
      }
      return operation;
    });
  }

  advance(
    operationId: string,
    expectedRevision: number,
    phase: ExtensionLifecyclePhase
  ) {
    return this.file.mutate((state) => {
      const operation = requireOperation(state.operations, operationId);
      /* 幂等：已经在目标相位就直接返回，重放不该把一条已推进的操作打回 409。 */
      if (operation.phase === phase) return operation;
      assertRevision(operation, expectedRevision);
      operation.revision += 1;
      operation.phase = phase;
      if (phase !== "staged") operation.blocked = null;
      return operation;
    });
  }

  /** 收敛步骤逐条落盘；同一步重复记录是幂等的。 */
  recordStep(operationId: string, step: ExtensionLifecycleStep) {
    return this.file.mutate((state) => {
      const operation = requireOperation(state.operations, operationId);
      if (!operation.completedSteps.includes(step)) {
        operation.completedSteps.push(step);
        operation.revision += 1;
      }
      return operation;
    });
  }

  /* block 不是终态：它让操作停在原地并把原因说出口，恢复时可以再试。
     「无法安全 snapshot」就走这条——绝不降级成另一种能发布的形态。 */
  block(operationId: string, reason: { code: string; message: string }) {
    return this.file.mutate((state) => {
      const operation = requireOperation(state.operations, operationId);
      operation.revision += 1;
      operation.blocked = { ...reason };
      return operation;
    });
  }

  abort(operationId: string) {
    return this.file.mutate((state) => {
      const operation = requireOperation(state.operations, operationId);
      if (operation.phase === "completed") {
        throw conflict("已完成的扩展生命周期操作不能 abort");
      }
      if (
        operation.installAuthorizationState === "prepared" &&
        operation.authorizedInstall
      ) {
        operation.installAuthorizationState = "none";
        operation.authorizedInstall = null;
      }
      operation.revision += 1;
      operation.phase = "aborted";
      return operation;
    });
  }

  /** 初始 Registry CAS 未提交时物理撤掉 staged intent，避免幽灵 admission gate。 */
  discardStaged(operationId: string) {
    return this.file.mutate((state) => {
      const operation = requireOperation(state.operations, operationId);
      if (operation.phase !== "staged" || operation.authorizedInstall) {
        throw conflict("只有未授权 staged lifecycle operation 可丢弃");
      }
      state.operations = state.operations.filter(
        (item) => item.operationId !== operationId
      );
    });
  }

  find(operationId: string) {
    return (
      this.file
        .snapshot()
        .operations.find((item) => item.operationId === operationId) ?? null
    );
  }

  /** 崩溃恢复的唯一入口：非终态操作即「有事没做完」。 */
  nonTerminal(kind?: ExtensionLifecycleKind) {
    return this.file
      .snapshot()
      .operations.filter(
        (item) =>
          !TERMINAL.includes(item.phase) && (!kind || item.kind === kind)
      );
  }

  snapshot() {
    return this.file.snapshot().operations;
  }
}

function requireOperation(
  operations: ExtensionLifecycleOperation[],
  operationId: string
) {
  const operation = operations.find((item) => item.operationId === operationId);
  if (!operation) throw new Error("扩展生命周期操作不存在");
  return operation;
}

function assertRevision(
  operation: ExtensionLifecycleOperation,
  expectedRevision: number
) {
  if (operation.revision !== expectedRevision) {
    throw conflict("扩展生命周期操作 revision 已变化");
  }
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}
