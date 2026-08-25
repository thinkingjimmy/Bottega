/**
 * [INPUT]: Depends on Node fs/path, zod, install/manifest-schema contractsheet, shared Apps Record contracts, Base GUI grant/build participant, app-extension-generation narrow ports/build participant registry with AppServerCutoverPort
 * [OUTPUT]: Provides AppStore v12 generation single writer, fsync-checkpointed v11 restage, interrupt/damaged backup isolation after an empty cold start, pure metadata update, explicit publish/cutover, immutable artifact root, active/pending/draining binding, zero capability, without consent and participant-first Base GUI decline/abort tasks
 * [POS]: The only source of truth for the enduring application modules; Generations are based on three abstract bindings of the release bytes and manifests, DTO dir is a variable workspace and not an execution root, and runtime root is derived only from a sealed receipt
 */

import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { agentBackendIdSchema } from "../../../shared/agent-schema";
import type {
  AppDomainIdentity,
  AppExtensionResolutionBinding,
  AppGeneration,
  AppGenerationRuntimeBinding,
  AppManifest,
  AppRecord,
  BaseGuiCapabilityDecision,
  BaseGuiCapability,
} from "../../../shared/apps-ipc";
import { requestedBaseGuiCapabilities } from "../../../shared/apps-ipc";
import type {
  AppExtensionRequirementDeclaration,
  Sha256Digest,
} from "../../../shared/extensions-ipc";
import type { AppGenerationBuildOperation } from "../../../shared/app-lifecycle";
import { errorMessage } from "../errors";
import { appManifestSchema } from "./install/manifest-schema";
import { SerialQueue } from "../persistence/serial-queue";
import { durableReplaceFile } from "../persistence/durable-json";
import type { AppGenerationBuildLedger } from "./app-generation-build-ledger";
import type {
  AppServerCutoverPort,
  PreparedServerCutover,
} from "./app-server-cutover";
import type {
  AppExtensionGenerationConsent,
  AppExtensionGenerationHandoff,
  AppExtensionGenerationPort,
} from "./app-extension-generation";
import type { AppGenerationBuildParticipantRegistry } from "../lifecycle/app-generation-build-participants";
import type { BaseGuiGrantStore } from "./base-gui/grant-store";
import { BaseGuiBuildParticipant } from "./base-gui/build-participant";
import {
  inspectPackageDigests,
  removePackageArtifact,
  sealPackageArtifact,
  verifyPackageArtifact,
  type PackageDigestSet,
} from "./share/package-contract";

const SCHEMA_VERSION = 12;
const APP_ID_PATTERN = /^[a-z0-9]{10}$/;
const REPO_PATTERN =
  /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const digestSchema = z
  .string()
  .regex(DIGEST_PATTERN)
  .transform((value) => value as `sha256:${string}`);

const packageGenerationRefSchema = z
  .object({
    packageGenerationId: z.string().min(1),
    recordDigest: digestSchema,
  })
  .strict();
const frozenReasonSchema = z
  .object({
    taxonomyVersion: z.literal(1),
    code: z.enum([
      "package-not-installed",
      "no-matching-generation",
      "generation-not-admitted",
      "generation-removal-pending",
      "component-not-found",
      "identity-conflict",
      "invalid-app-config",
    ]),
    parameters: z.record(z.string(), z.string()),
    evidenceDigest: digestSchema,
  })
  .strict();
const frozenRequirementSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("resolved"),
      componentIdentity: z.string().min(1),
      packageGenerationRef: packageGenerationRefSchema,
      required: z.boolean(),
      declarationDigest: digestSchema,
      resolvedConfigDigest: digestSchema,
      capabilitySetDigest: digestSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal("unresolved"),
      componentIdentity: z.string().min(1),
      required: z.boolean(),
      declarationDigest: digestSchema,
      reason: frozenReasonSchema,
    })
    .strict(),
]);
const frozenSetSchema = z
  .object({
    resolutionId: z.string().min(1),
    appGenerationId: z.string().min(1),
    registryRevision: z.string().min(1),
    inventorySnapshotDigest: digestSchema,
    graphDigest: digestSchema,
    resolutionDigest: digestSchema,
    status: z.enum(["ready", "degraded", "blocked"]),
    extensionRequirements: z.array(frozenRequirementSchema),
  })
  .strict();
const extensionResolutionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("frozen"),
      frozenSet: frozenSetSchema,
      packageGenerationReservationId: z.string().min(1),
    })
    .strict(),
]);
const runtimeBindingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({ kind: z.literal("server"), dataEpochId: z.string().min(1) })
    .strict(),
]);
const legacyGenerationSchema = z
  .object({
    generationId: z.string().min(1),
    generationBuildId: z.string().min(1),
    contentDigest: digestSchema,
    manifest: appManifestSchema,
    extensionRequirementResolution: extensionResolutionSchema,
    contentLayoutVersion: z.literal(1),
    createdAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine(
  (generation, context) => {
    if (generation.contentDigest !== digest({ manifest: generation.manifest })) {
      context.addIssue({
        code: "custom",
        path: ["contentDigest"],
        message: "App generation sealed manifest digest 不匹配",
      });
    }
  }
);
const generationV2Schema = z
  .object({
    generationId: z.string().min(1),
    generationBuildId: z.string().min(1),
    manifestDigest: digestSchema,
    sourcePackageDigest: digestSchema,
    contentDigest: digestSchema,
    manifest: appManifestSchema,
    extensionRequirementResolution: extensionResolutionSchema,
    contentLayoutVersion: z.literal(2),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
/* v1 只允许 load 后立刻 restage；所有 commit 都由 commitRecord 的 v2 guard 拦住。 */
const generationSchema = z.union([legacyGenerationSchema, generationV2Schema]);
const domainIdentitySchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("no-data"), appKind: z.enum(["static", "server"]) })
    .strict(),
  z
    .object({
      kind: z.literal("base"),
      domain: z.object({ kind: z.literal("ordinary") }).strict(),
    })
    .strict(),
]);
const generationBindingSchema = z
  .object({
    bindingRevision: z.number().int().nonnegative(),
    active: z
      .object({ generationId: z.string().min(1), runtime: runtimeBindingSchema })
      .strict()
      .nullable(),
    pending: z
      .object({
        generationId: z.string().min(1),
        expectedActiveGenerationId: z.string().min(1).nullable(),
        resolutionDigest: digestSchema,
        packageGenerationReservationId: z.string().min(1),
        runtime: runtimeBindingSchema,
        consentDecisionId: z.string().min(1),
        expectedConsentRevision: z.number().int().nonnegative(),
        baseGuiDecision: z
          .object({
            decisionId: z.string().uuid(),
            expectedRevision: z.number().int().positive(),
            requestedCapabilities: z.array(
              z.enum(["row-insert", "row-patch", "row-delete", "attachment-read"])
            ).max(4),
            state: z.enum(["consent-required", "approved", "declined"]),
          })
          .strict()
          .optional(),
        extensionState: z
          .enum(["consent-required", "ready-to-promote"])
          .optional(),
        state: z.enum(["consent-required", "ready-to-promote"]),
      })
      .strict()
      .optional(),
    drainingGenerationIds: z.array(z.string().min(1)),
  })
  .strict();

const appRecordSchema = z
  .object({
    id: z.string().regex(APP_ID_PATTERN),
    sourceRepoUrl: z.string().regex(REPO_PATTERN).nullable(),
    publishedRepoUrl: z.string().regex(REPO_PATTERN).nullable(),
    origin: z.enum(["github", "local", "preset"]),
    presetId: z.string().regex(/^[a-z][a-z0-9-]{1,38}$/).optional(),
    installedPresetPin: z.string().regex(/^[0-9a-f]{40}$/).optional(),
    displayName: z.string().trim().min(1).max(250),
    dir: z.string().min(1),
    state: z.enum([
      "creating",
      "installing",
      "ready",
      "install-failed",
      "updating",
      "update-failed",
      "deleting",
      "delete-failed",
      "quarantined",
    ]),
    lastError: z
      .object({
        phase: z.enum([
          "clone",
          "manifest",
          "install",
          "build",
          "start",
          "update",
          "delete",
        ]),
        message: z.string().min(1).max(4_000),
      })
      .strict()
      .nullable(),
    agentWarning: z.string().min(1).max(4_000).nullable(),
    agent: agentBackendIdSchema,
    maintenanceAgent: z.union([
      agentBackendIdSchema,
      z.literal("auto"),
    ]),
    headlessConsent: z
      .object({
        backend: agentBackendIdSchema,
        version: z.string().min(1).max(200).optional(),
        consentAt: z.number().int().nonnegative().optional(),
        inherited: z.boolean().optional(),
      })
      .strict()
      .nullable(),
    bindingRevision: z.number().int().nonnegative(),
    lifecycleRevision: z.number().int().nonnegative(),
    defaultGrant: z
      .object({
        appId: z.string().regex(APP_ID_PATTERN),
        data: z
          .object({ kind: z.literal("base"), level: z.enum(["read", "row-write"]) })
          .strict()
          .optional(),
        agentDelegation: z
          .object({ fileRead: z.boolean(), useData: z.boolean() })
          .strict(),
        grantedAt: z.number().int().nonnegative(),
      })
      .strict()
      .nullable()
      .default(null),
    defaultGrantRevision: z.number().int().nonnegative().default(0),
    domainIdentity: domainIdentitySchema.nullable(),
    generations: z.array(generationSchema),
    generationBinding: generationBindingSchema,
    manifest: appManifestSchema.nullable(),
    editChatSlot: z
      .object({
        id: z.string().min(1).max(128),
        state: z.enum(["draft", "canonical"]),
      })
      .strict()
      .nullable(),
    activeUseChatSlot: z
      .object({
        id: z.string().min(1).max(128),
        state: z.enum(["draft", "canonical"]),
      })
      .strict()
      .nullable(),
    skillStatus: z
      .object({
        state: z.enum(["pending", "done", "failed"]),
        turnIntentId: z.string().min(1).max(256),
      })
      .strict()
      .nullable(),
    addedAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((record, context) => {
    /* 来源与来源仓库是同一件事的两面：github 必有、其余必无，双向断言消灭中间态。 */
    if (record.origin === "github" && !record.sourceRepoUrl) {
      context.addIssue({
        code: "custom",
        path: ["sourceRepoUrl"],
        message: "GitHub App 必须保留导入来源",
      });
    }
    if (record.origin !== "github" && record.sourceRepoUrl) {
      context.addIssue({
        code: "custom",
        path: ["sourceRepoUrl"],
        message: `${record.origin} App 不应携带导入来源`,
      });
    }
    if (
      record.origin === "preset" &&
      (!record.presetId || !record.installedPresetPin)
    ) {
      context.addIssue({
        code: "custom",
        path: ["presetId"],
        message: "Preset App 必须保留 presetId 与 installedPresetPin",
      });
    }
    if (
      record.origin !== "preset" &&
      (record.presetId || record.installedPresetPin)
    ) {
      context.addIssue({
        code: "custom",
        path: ["presetId"],
        message: "非 Preset App 不应携带 preset provenance",
      });
    }
    const generationIds = record.generations.map(
      (generation) => generation.generationId
    );
    const ids = new Set(generationIds);
    if (ids.size !== generationIds.length) {
      context.addIssue({
        code: "custom",
        path: ["generations"],
        message: "generationId 不可重复",
      });
    }
    const activeId = record.generationBinding.active?.generationId;
    const active = record.generations.find(
      (generation) => generation.generationId === activeId
    );
    if (activeId && !active) {
      context.addIssue({
        code: "custom",
        path: ["generationBinding", "active"],
        message: "active generation 不存在",
      });
    }
    if (
      record.generationBinding.pending &&
      !ids.has(record.generationBinding.pending.generationId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["generationBinding", "pending"],
        message: "pending generation 不存在",
      });
    }
    if (
      active &&
      JSON.stringify(active.manifest) !== JSON.stringify(record.manifest)
    ) {
      context.addIssue({
        code: "custom",
        path: ["manifest"],
        message: "manifest projection 与 active generation 不一致",
      });
    }
    if (!active && record.manifest !== null) {
      context.addIssue({
        code: "custom",
        path: ["manifest"],
        message: "无 active generation 时 manifest 必须为空",
      });
    }
  });

const storeSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    apps: z.array(appRecordSchema).max(100),
    retiredIds: z
      .array(z.string().regex(APP_ID_PATTERN))
      .max(10_000)
      .default([]),
  })
  .strict()
  .superRefine((file, context) => {
    for (const [appIndex, app] of file.apps.entries()) {
      for (const [generationIndex, generation] of app.generations.entries()) {
        if (generation.contentLayoutVersion === 2) continue;
        context.addIssue({
          code: "custom",
          path: ["apps", appIndex, "generations", generationIndex],
          message: "apps.json v12 不得包含 legacy generation",
        });
      }
    }
  });

type StoreFile = z.infer<typeof storeSchema>;

const legacyStoreSchema = z
  .object({
    schemaVersion: z.literal(11),
    apps: z.array(appRecordSchema).max(100),
    retiredIds: z.array(z.string().regex(APP_ID_PATTERN)).max(10_000).default([]),
  })
  .strict();

const legacyMigrationCheckpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    pendingAppIds: z.array(z.string().regex(APP_ID_PATTERN)).max(100),
  })
  .strict();
type LegacyMigrationCheckpoint = z.infer<
  typeof legacyMigrationCheckpointSchema
>;

/** v11 是唯一迁移入口；其 shape 先完整验真，再由 load 备份并 restage。
 *  其它旧版/未来版一律抛错，不猜逐版本语义——由 load 备份 `.bak` 后隔离，
 *  按空态冷启动继续（启动不崩，App 重装即可）。 */
function parseStore(raw: unknown): { file: StoreFile; legacy: boolean } {
  const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version === SCHEMA_VERSION) {
    return { file: storeSchema.parse(raw), legacy: false };
  }
  if (version === 11) {
    const legacy = legacyStoreSchema.parse(raw);
    return {
      file: { ...legacy, schemaVersion: SCHEMA_VERSION },
      legacy: true,
    };
  }
  throw new Error(`不支持的 apps.json schemaVersion：${String(version)}`);
}

function digest(value: unknown): `sha256:${string}` {
  const hash = createHash("sha256").update(canonicalJson(value)).digest("hex");
  return `sha256:${hash}`;
}

/**
 * seal 时的 content digest 唯一计算点。测试播种 generation 必须调它而不是抄一份：
 * 抄出来的 digest 只证明抄得对，证明不了被测代码认的是同一个值。
 */
export function sealedContentDigest(manifest: AppManifest) {
  return digest({ manifest });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function domainIdentity(manifest: AppManifest) {
  if (manifest.kind === "static" || manifest.kind === "server") {
    return { kind: "no-data" as const, appKind: manifest.kind };
  }
  return { kind: "base" as const, domain: { kind: "ordinary" as const } };
}

export class AppStore {
  readonly appsRoot: string;
  readonly artifactsRoot: string;
  readonly filePath: string;
  readonly legacyMigrationPath: string;
  private records = new Map<string, AppRecord>();
  private retiredIds = new Set<string>();
  private readonly queue = new SerialQueue();
  private buildLedger: AppGenerationBuildLedger | null = null;
  private serverCutover: AppServerCutoverPort | null = null;
  private participants: AppGenerationBuildParticipantRegistry | null = null;
  private extensions: AppExtensionGenerationPort | null = null;
  private baseGuiGrants: BaseGuiGrantStore | null = null;
  private baseGuiParticipant: BaseGuiBuildParticipant | null = null;
  private generationCutover:
    | (<T>(appId: string, operation: () => Promise<T>) => Promise<T>)
    | null = null;

  constructor(private readonly userData: string) {
    this.appsRoot = join(userData, "apps");
    this.artifactsRoot = join(userData, "app-generation-artifacts");
    this.filePath = join(userData, "apps.json");
    this.legacyMigrationPath = join(userData, "apps-v11-migration.json");
  }

  configureGenerationLifecycle(
    buildLedger: AppGenerationBuildLedger,
    serverCutover: AppServerCutoverPort
  ) {
    if (this.buildLedger || this.serverCutover) {
      throw new Error("App generation lifecycle 已配置");
    }
    this.buildLedger = buildLedger;
    this.serverCutover = serverCutover;
  }

  /* 组合根注册；未注册时含 extensionRequirements 的 build 直接 fail closed，
     绝不降级成「当作没有声明」继续发布。 */
  configureExtensionComposition(
    participants: AppGenerationBuildParticipantRegistry,
    extensions: AppExtensionGenerationPort
  ) {
    if (this.participants || this.extensions) {
      throw new Error("App extension composition 已配置");
    }
    this.participants = participants;
    this.extensions = extensions;
    if (this.baseGuiParticipant) {
      participants.register(
        "base-gui",
        this.baseGuiParticipant
      );
    }
  }

  configureBaseGuiGrants(grants: BaseGuiGrantStore) {
    if (this.baseGuiGrants) throw new Error("Base GUI grant store 已配置");
    this.baseGuiGrants = grants;
    this.baseGuiParticipant = new BaseGuiBuildParticipant(grants);
  }

  /** generation publish 的宿主 drain；Store 不认识 BrowserWindow，只认事务边界。 */
  configureGenerationCutover(
    cutover: <T>(appId: string, operation: () => Promise<T>) => Promise<T>
  ) {
    if (this.generationCutover) throw new Error("App generation cutover 已配置");
    this.generationCutover = cutover;
  }

  async initialize() {
    await this.load();
    await this.normalizeInterrupted();
  }

  async load() {
    await Promise.all([
      mkdir(this.appsRoot, { recursive: true }),
      mkdir(this.artifactsRoot, { recursive: true, mode: 0o700 }),
    ]);
    let parsed: StoreFile;
    let legacy = false;
    try {
      const result = parseStore(JSON.parse(await readFile(this.filePath, "utf8")));
      parsed = result.file;
      legacy = result.legacy;
      this.assertDerivedPaths(parsed.apps);
    } catch (cause) {
      const error = cause as NodeJS.ErrnoException;
      if (error.code === "ENOENT") return;
      /* 断代/损坏不得把整个 main 拖死：备份留证后按冷启动继续（≡ 首次安装的
         空态路径）。上抛只会让 `appsService.initialize()` 挂掉进程，用户连
         重装 App 的界面都进不去——隔离比 fail-closed 便宜得多。 */
      await copyFile(this.filePath, `${this.filePath}.bak`).catch(() => {});
      console.warn(
        `[apps] apps.json 无法读取，已隔离旧版数据（备份至 ${this.filePath}.bak），Base App 请重装：${errorMessage(cause)}`
      );
      return;
    }

    for (const record of parsed.apps) {
      this.records.set(record.id, structuredClone(record));
    }
    this.retiredIds = new Set([
      ...parsed.retiredIds,
      ...parsed.apps.map((record) => record.id),
    ]);
    const checkpoint = await this.readLegacyMigrationCheckpoint();
    if (legacy) {
      await durableReplaceFile(
        `${this.filePath}.v11.bak`,
        await readFile(this.filePath, "utf8")
      );
      await this.migrateLegacyV11(parsed.apps);
    } else if (checkpoint) {
      const backup = legacyStoreSchema.parse(
        JSON.parse(await readFile(`${this.filePath}.v11.bak`, "utf8"))
      );
      this.assertDerivedPaths(backup.apps);
      await this.migrateLegacyV11(backup.apps, checkpoint);
    } else {
      await this.reconcileArtifacts();
    }
  }

  /** active route 只消费此派生路径；workspace `record.dir` 永远不是 generation root。 */
  contentRoot(appId: string, generationId: string) {
    return join(this.artifactRoot(appId, generationId), "runtime");
  }

  private artifactRoot(appId: string, generationId: string) {
    return join(this.artifactsRoot, appId, generationId);
  }

  async normalizeInterrupted() {
    let recovered = false;
    for (const [appId, record] of this.records) {
      if (record.state !== "installing" && record.state !== "updating") continue;
      const installing = record.state === "installing";
      this.records.set(appId, {
        ...record,
        state: installing ? "install-failed" : "update-failed",
        lastError: {
          phase: installing ? "install" : "update",
          message: "上次操作被中断",
        },
      });
      recovered = true;
    }
    if (recovered) await this.persist();
  }

  /**
   * v11 只证明 manifest，不能继续当 active。checkpoint 必须先于 v12 失效提交；
   * 此后每个 App 都以「v2 AppRecord 已提交 → 从 pending 移除」为 WAL 顺序。
   * 进程死在任意两步之间，下一次启动都从 `.v11.bak` 找回输入并幂等续跑。
   */
  private async migrateLegacyV11(
    legacy: readonly AppRecord[],
    existingCheckpoint?: LegacyMigrationCheckpoint
  ) {
    let checkpoint =
      existingCheckpoint ?? {
        schemaVersion: 1 as const,
        pendingAppIds: legacy.map((record) => record.id),
      };
    if (!existingCheckpoint) {
      await this.writeLegacyMigrationCheckpoint(checkpoint);
      this.records.clear();
      for (const record of legacy) {
        this.records.set(record.id, {
          ...record,
          lifecycleRevision: record.lifecycleRevision + 1,
          generations: [],
          generationBinding: {
            bindingRevision: record.generationBinding.bindingRevision + 1,
            active: null,
            drainingGenerationIds: [],
          },
          manifest: null,
        });
      }
      await this.persist();
    }

    const byId = new Map(legacy.map((record) => [record.id, record]));
    for (const appId of [...checkpoint.pendingAppIds]) {
      const old = byId.get(appId);
      if (!old) {
        checkpoint = await this.completeLegacyMigrationApp(checkpoint, appId);
        continue;
      }
      const alreadyRestaged = this.records
        .get(appId)
        ?.generations.some((generation) => generation.contentLayoutVersion === 2);
      if (alreadyRestaged) {
        checkpoint = await this.completeLegacyMigrationApp(checkpoint, appId);
        continue;
      }
      try {
        const manifest = appManifestSchema.parse(
          JSON.parse(await readFile(join(old.dir, "app.json"), "utf8"))
        );
        await this.withServerCutover(old.id, () => ({
          ...this.get(old.id)!,
          manifest,
        }));
      } catch (cause) {
        await this.queue.enqueue(async () => {
          const current = this.records.get(old.id);
          if (!current) return;
          await this.commitRecord(
            {
              ...current,
              state: "quarantined",
              manifest: null,
              lastError: {
                phase: "manifest",
                message: `v11 restage 失败：${errorMessage(cause)}`,
              },
            },
            old.id,
            current
          );
        });
      }
      checkpoint = await this.completeLegacyMigrationApp(checkpoint, appId);
    }
    await rm(this.legacyMigrationPath, { force: true });
    await this.sweepArtifacts();
  }

  private async readLegacyMigrationCheckpoint() {
    try {
      return legacyMigrationCheckpointSchema.parse(
        JSON.parse(await readFile(this.legacyMigrationPath, "utf8"))
      );
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(`Apps v11 迁移 checkpoint 无效：${errorMessage(cause)}`, {
        cause,
      });
    }
  }

  private async completeLegacyMigrationApp(
    checkpoint: LegacyMigrationCheckpoint,
    appId: string
  ) {
    const next = {
      ...checkpoint,
      pendingAppIds: checkpoint.pendingAppIds.filter((id) => id !== appId),
    };
    await this.writeLegacyMigrationCheckpoint(next);
    return next;
  }

  private async writeLegacyMigrationCheckpoint(
    checkpoint: LegacyMigrationCheckpoint
  ) {
    await durableReplaceFile(
      this.legacyMigrationPath,
      `${JSON.stringify(checkpoint, null, 2)}\n`
    );
  }

  /** Zod 只验记录 shape；active/pending 的真实磁盘字节在启动期异步复验。 */
  private async reconcileArtifacts() {
    let changed = false;
    for (const [appId, record] of this.records) {
      const liveIds = new Set(
        [
          record.generationBinding.active?.generationId,
          record.generationBinding.pending?.generationId,
        ].filter((value): value is string => Boolean(value))
      );
      try {
        for (const generation of record.generations) {
          if (!liveIds.has(generation.generationId)) continue;
          if (
            generation.contentLayoutVersion !== 2 ||
            !generation.manifestDigest ||
            !generation.sourcePackageDigest
          ) {
            throw new Error("active generation 不是 v2 sealed artifact");
          }
          await verifyPackageArtifact({
            root: this.artifactRoot(appId, generation.generationId),
            manifest: generation.manifest,
            expected: generationDigests(generation),
          });
        }
      } catch (cause) {
        this.records.set(appId, {
          ...record,
          state: "quarantined",
          lifecycleRevision: record.lifecycleRevision + 1,
          manifest: null,
          lastError: {
            phase: "manifest",
            message: `generation artifact 复验失败：${errorMessage(cause)}`,
          },
          generationBinding: {
            ...record.generationBinding,
            bindingRevision: record.generationBinding.bindingRevision + 1,
            active: null,
            pending: undefined,
          },
        });
        changed = true;
      }
    }
    if (changed) await this.persist();
    await this.sweepArtifacts();
  }

  private async sweepArtifacts() {
    const reachable = new Set<string>();
    for (const record of this.records.values()) {
      for (const generation of record.generations) {
        reachable.add(`${record.id}/${generation.generationId}`);
      }
    }
    for (const operation of this.buildLedger?.listNonTerminal() ?? []) {
      reachable.add(`${operation.appId}/${operation.appGenerationId}`);
    }
    for (const appId of await readdir(this.artifactsRoot).catch(() => [])) {
      const appRoot = join(this.artifactsRoot, appId);
      for (const generationId of await readdir(appRoot).catch(() => [])) {
        const path = join(appRoot, generationId);
        if (generationId.startsWith(".")) {
          await removePackageArtifact(path);
          continue;
        }
        if (reachable.has(`${appId}/${generationId}`)) continue;
        const target = join(appRoot, `.trash-${randomUUID()}`);
        const moved = await rename(path, target).then(
          () => true,
          () => false
        );
        if (moved) await removePackageArtifact(target);
      }
    }
  }

  list() {
    return [...this.records.values()]
      .sort((left, right) => left.addedAt - right.addedAt)
      .map((record) => structuredClone(record));
  }

  get(appId: string) {
    const record = this.records.get(appId);
    return record ? structuredClone(record) : undefined;
  }

  hasRetiredId(appId: string) {
    return this.retiredIds.has(appId);
  }

  async reserveId(appId: string) {
    await this.queue.enqueue(async () => {
      if (!APP_ID_PATTERN.test(appId)) throw new Error("App id 格式无效");
      if (this.retiredIds.has(appId)) throw new Error("App id 已退役");
      this.retiredIds.add(appId);
      try {
        await this.persist();
      } catch (cause) {
        this.retiredIds.delete(appId);
        throw cause;
      }
    });
  }

  async set(
    record: AppRecord,
    options: Readonly<{ generationSourceDir?: string }> = {}
  ) {
    return this.withGenerationCutover(record.id, () =>
      this.withServerCutover(record.id, () => record, {
        sourceDir: options.generationSourceDir,
      })
    );
  }

  /** 普通 update 只提交调用者给出的 AppRecord；绝不读取 workspace、seal 或换代。 */
  async update(
    appId: string,
    updater: (record: AppRecord) => AppRecord
  ) {
    return this.queue.enqueue(() => {
      const current = this.records.get(appId);
      if (!current) throw new Error("App 不存在");
      return this.commitRecord(updater(structuredClone(current)), appId, current);
    });
  }

  /** 构建并发布新 generation 的唯一显式入口；有 active 时必经宿主 GUI drain。 */
  async publishGeneration(
    appId: string,
    updater: (record: AppRecord) => AppRecord,
    options: Readonly<{ generationSourceDir?: string }> = {}
  ) {
    return this.withGenerationCutover(appId, () =>
      this.withServerCutover(
        appId,
        () => {
          const current = this.get(appId);
          if (!current) throw new Error("App 不存在");
          return updater(current);
        },
        { sourceDir: options.generationSourceDir }
      )
    );
  }

  async setDefaultGrant(
    appId: string,
    grant: AppRecord["defaultGrant"]
  ) {
    return this.update(appId, (current) => ({
      ...current,
      defaultGrant: grant ? structuredClone(grant) : null,
      defaultGrantRevision: (current.defaultGrantRevision ?? 0) + 1,
    }));
  }

  /** capability tombstone 已 durable 后，只推进 fence；绝不因 workspace 漂移暗建新代。 */
  async advanceLifecycle(appId: string) {
    return this.queue.enqueue(async () => {
      const current = this.records.get(appId);
      if (!current) throw new Error("App 不存在");
      return this.commitRecord(
        { ...current, lifecycleRevision: current.lifecycleRevision + 1 },
        appId,
        current
      );
    });
  }

  /**
   * Extension 更新后的 App 迁移入口（`08-09-app-extension-integration.md` §8.2）。
   *
   * 即使 manifest 一个字节都没变，也必须是**新的一代**：新 generationId、在新
   * inventory 上重新冻结的 requirement graph、新代 scoped grants。旧代与旧
   * grant 继续指向旧 package ref，绝不原地换绑——原地换绑会让一份已授权的
   * frozen graph 悄悄漂到用户没批准过的字节上。
   */
  async migrateGeneration(appId: string, migrationId: string) {
    if (!migrationId.trim()) throw new Error("App generation migrationId 无效");
    return this.withGenerationCutover(appId, () =>
      this.withServerCutover(
        appId,
        () => {
          const current = this.get(appId);
          if (!current) throw new Error("App 不存在");
          if (!current.manifest?.extensionRequirements?.length) {
            throw new Error("该 App 没有 extension 声明，无需迁移");
          }
          return current;
        },
        { migrationId }
      )
    );
  }

  private withGenerationCutover<T>(
    appId: string,
    operation: () => Promise<T>
  ) {
    return this.records.get(appId)?.generationBinding.active && this.generationCutover
      ? this.generationCutover(appId, operation)
      : operation();
  }

  /**
   * §3.4 的顺序在这里成立：**队列外**先按当前快照预判「这次写入会不会产生
   * 一代新的 active server generation」，是就先跑完关准入/撤 route/drain/stop/
   * 造 target epoch，然后才进队列做那个短临界区的整体 CAS。
   *
   * 把等待搬进队列会让 Store queue 反向持住 lifecycle gate（D26 明令 fail-fast），
   * 把 CAS 搬出队列则会让两次写入交叉——所以两者必须在这里分开。
   */
  private async withServerCutover(
    appId: string,
    compute: () => AppRecord,
    options: GenerationPlanOptions = {}
  ) {
    const current = this.records.get(appId);
    const defaultBuildId = `build-${appId}-${(current?.lifecycleRevision ?? 0) + 1}`;
    const plannedOptions =
      !options.migrationId && this.buildLedger?.isRetired(defaultBuildId)
        ? {
            ...options,
            identitySuffix: randomUUID().replaceAll("-", "").slice(0, 16),
          }
        : options;
    const preview = await planGeneration(
      compute(),
      current,
      plannedOptions
    );
    const prepared =
      preview && needsServerEpoch(preview) && this.serverCutover
        ? await this.serverCutover.prepare({
            appId,
            generationBuildId: preview.generationBuildId,
            generationId: preview.generationId,
          })
        : null;
    try {
      const committed = await this.queue.enqueue(() =>
        this.setUnlocked(compute(), prepared, plannedOptions)
      );
      await prepared?.commit();
      return committed;
    } catch (cause) {
      await prepared?.abort();
      throw cause;
    }
  }

  /* 用户对该 pending 代的同意/拒绝：GrantStore 单 commit 写 exact grant set，
     AppRecord 只跟随更新 decision 指针，绝不自己解释授权。 */
  async resolvePendingConsent(appId: string, granted: boolean) {
    return this.queue.enqueue(async () => {
      const current = this.get(appId);
      const pending = current?.generationBinding.pending;
      if (!current || !pending) throw new Error("App 没有待同意的 generation");
      const resolution = current.generations.find(
        (item) => item.generationId === pending.generationId
      )?.extensionRequirementResolution;
      if (resolution?.kind !== "frozen" || !this.extensions) {
        throw new Error("pending generation 未冻结 extension resolution");
      }
      const consent = await this.extensions.resolveConsent({
        appId,
        frozenSet: resolution.frozenSet,
        consentDecisionId: pending.consentDecisionId,
        expectedConsentRevision: pending.expectedConsentRevision,
        granted,
      });
      const nextPending = {
        ...pending,
        ...consent,
        extensionState: consent.state,
      };
      nextPending.state = allParticipantsPromotable(nextPending)
        ? "ready-to-promote"
        : "consent-required";
      return this.commitRecord(
        {
          ...current,
          generationBinding: {
            ...current.generationBinding,
            pending: nextPending,
          },
        },
        appId,
        current
      );
    });
  }


  async resolvePendingBaseGuiConsent(
    appId: string,
    grantedCapabilities: readonly BaseGuiCapability[]
  ) {
    return this.queue.enqueue(async () => {
      const current = this.get(appId);
      const pending = current?.generationBinding.pending;
      const pointer = pending?.baseGuiDecision;
      const generation = current?.generations.find(
        (item) => item.generationId === pending?.generationId
      );
      if (!current || !pending || !pointer || !generation || !this.baseGuiGrants) {
        throw new Error("App 没有待处理的 Base GUI capability decision");
      }
      const decision = await this.baseGuiGrants.decide({
        appId,
        generationId: generation.generationId,
        decisionId: pointer.decisionId,
        expectedRevision: pointer.expectedRevision,
        contentDigest: generation.contentDigest,
        grantedCapabilities,
      });
      if (decision.state === "declined") {
        // participant tombstone 是资源释放的提交点；AppRecord 只能在它之后删 pending。
        // 反过来会让崩溃后的 ledger 失去可重试的 generation 定位信息。
        await this.abortGenerationBuild(appId, generation);
        const declined = {
          ...current,
          lifecycleRevision: current.lifecycleRevision + 1,
          generations: current.generations.filter(
            (item) => item.generationId !== pending.generationId
          ),
          generationBinding: {
            ...current.generationBinding,
            bindingRevision: current.generationBinding.bindingRevision + 1,
            pending: undefined,
          },
        };
        const committed = await this.commitRecord(declined, appId, current);
        await this.discardArtifact(appId, pending.generationId);
        return committed;
      }
      const nextPending = {
        ...pending,
        ...(generation.extensionRequirementResolution.kind === "none"
          ? {
              consentDecisionId: decision.decisionId,
              expectedConsentRevision: decision.revision,
            }
          : {}),
        baseGuiDecision: decisionPointer(decision),
      };
      nextPending.state = allParticipantsPromotable(nextPending)
        ? "ready-to-promote"
        : "consent-required";
      return this.commitRecord(
        {
          ...current,
          generationBinding: {
            ...current.generationBinding,
            pending: nextPending,
          },
        },
        appId,
        current
      );
    });
  }

  /* pending→active 的唯一入口：复核 build/reservation/decision 三份证据后才 CAS。
     旧 active 只进 draining，回收仍由统一 retirement coordinator 决定。 */
  async promotePendingGeneration(appId: string, expectedConsentRevision: number) {
    /* pending 的 server 代同样是「新的 active writer」：它必须先经过与普通
       更新完全相同的 drain/stop/隔离构造，才谈得上 CAS。 */
    const pendingBefore = this.get(appId)?.generationBinding.pending;
    const generationBefore = this.get(appId)?.generations.find(
      (item) => item.generationId === pendingBefore?.generationId
    );
    const prepared =
      pendingBefore &&
      generationBefore?.manifest.kind === "server" &&
      this.serverCutover
        ? await this.serverCutover.prepare({
            appId,
            generationBuildId: generationBefore.generationBuildId,
            generationId: pendingBefore.generationId,
          })
        : null;
    try {
      const promoted = await this.promoteUnlocked(
        appId,
        expectedConsentRevision,
        prepared
      );
      await prepared?.commit();
      return promoted;
    } catch (cause) {
      await prepared?.abort();
      throw cause;
    }
  }

  private async promoteUnlocked(
    appId: string,
    expectedConsentRevision: number,
    prepared: PreparedServerCutover | null
  ) {
    return this.queue.enqueue(async () => {
      const current = this.get(appId);
      const pending = current?.generationBinding.pending;
      if (!current || !pending) throw new Error("App 没有待 promote 的 generation");
      if (
        pending.expectedActiveGenerationId !==
        (current.generationBinding.active?.generationId ?? null)
      ) {
        throw conflict("active generation 已变化，pending 失效");
      }
      if (pending.expectedConsentRevision !== expectedConsentRevision) {
        throw conflict("App extension consent revision 已变化");
      }
      const generation = current.generations.find(
        (item) => item.generationId === pending.generationId
      );
      if (!generation) throw new Error("pending generation 不存在");
      if (generation.extensionRequirementResolution.kind === "frozen") {
        if (
          !this.extensions?.promotable({
            appId,
            appGenerationId: pending.generationId,
            consentDecisionId: pending.consentDecisionId,
            expectedConsentRevision,
          })
        ) {
          throw conflict("App extension consent 尚未终结或已被撤销");
        }
      }
      if (pending.baseGuiDecision) {
        if (
          !this.baseGuiGrants?.promotable({
            appId,
            generationId: generation.generationId,
            contentDigest: generation.contentDigest,
            decisionId: pending.baseGuiDecision.decisionId,
            expectedRevision: pending.baseGuiDecision.expectedRevision,
          })
        ) {
          throw conflict("Base GUI capability consent 尚未终结或已被撤销");
        }
      }
      if (generation.manifest.kind === "server" && this.serverCutover) {
        if (!prepared || prepared.generationId !== pending.generationId) {
          throw conflict("server data cutover 与本次 promote 不匹配");
        }
      }
      const promoted = await this.commitRecord(
        promoteBinding(current, generation, pending, prepared?.dataEpochId),
        appId,
        current
      );
      const operation = this.buildLedger
        ?.listNonTerminal(appId)
        .find((item) => item.generationBuildId === generation.generationBuildId);
      if (operation) {
        await this.buildLedger!.advance(
          operation.generationBuildId,
          operation.revision,
          "promoted"
        );
      }
      return promoted;
    });
  }

  async remove(appId: string) {
    await this.queue.enqueue(async () => {
      const current = this.records.get(appId);
      if (!current) return;
      this.records.delete(appId);
      try {
        await this.persist();
      } catch (cause) {
        this.records.set(appId, current);
        throw cause;
      }
      for (const generation of current.generations) {
        await this.discardArtifact(appId, generation.generationId).catch(() => {});
      }
    });
  }

  async closeAndFlush() {
    this.queue.close();
    await this.queue.flush();
  }

  reopen() {
    this.queue.reopen();
  }

  private async setUnlocked(
    record: AppRecord,
    prepared: PreparedServerCutover | null = null,
    options: GenerationPlanOptions = {}
  ) {
    const previous = this.records.get(record.id);
    const plan = await planGeneration(record, previous, options);
    if (!plan) return this.commitRecord(record, record.id, previous);
    await sealPackageArtifact({
      source: plan.sourceDir,
      finalRoot: this.artifactRoot(record.id, plan.generationId),
      manifest: plan.manifest,
      expected: plan.digests,
    });
    let operation: AppGenerationBuildOperation | null = null;
    let committed = false;
    try {
      operation = await this.beginBuild(plan);
      /* 有声明就必须先拿到 participant 的 prepared handoff：pending 代只引用
         committed reservation 与 decision，永不直接 CAS active。 */
      const staged = plan.declarations.length
        ? await this.stageExtension(plan, operation)
        : {
            record: bindActive(plan, sealGeneration(plan, { kind: "none" })),
            operation: null,
          };
      if (staged.operation) operation = staged.operation;
      const capabilityBound = await this.bindBaseGuiCapability(
        plan,
        staged.record,
        operation
      );
      operation = capabilityBound.operation;
      const bound = this.bindPreparedEpoch(capabilityBound.record, plan, prepared);
      await this.commitRecord(bound, record.id, previous);
      committed = true;
      await this.settleBuild(plan, operation);
      return this.get(record.id)!;
    } catch (cause) {
      if (!committed) {
        try {
          await this.rollbackBuild(plan, operation);
        } catch (rollbackCause) {
          throw new AggregateError(
            [cause, rollbackCause],
            "generation build 失败且 participant abort 未完全收口"
          );
        }
      }
      throw cause;
    }
  }

  private async bindBaseGuiCapability(
    plan: NewGenerationPlan,
    record: AppRecord,
    operation: AppGenerationBuildOperation | null
  ) {
    if (plan.manifest.kind !== "base") return { record, operation };
    if (plan.requestedBaseGuiCapabilities.length === 0) {
      return { record, operation };
    }
    if (!this.baseGuiGrants) {
      throw new Error("Base GUI capability generation 需要已初始化的 grant store");
    }
    const generation = record.generations.find(
      (item) => item.generationId === plan.generationId
    );
    if (!generation) throw new Error("Base GUI capability generation 尚未 sealed");
    let decision: BaseGuiCapabilityDecision;
    if (operation && this.baseGuiParticipant && this.buildLedger) {
      const prepared = await this.baseGuiParticipant.prepare(operation);
      const checkpointed = await this.buildLedger.checkpoint(
        operation.generationBuildId,
        operation.revision,
        prepared
      );
      operation = checkpointed;
      const durable = this.baseGuiGrants.decision(prepared.operationId);
      if (prepared.state !== "prepared" || !durable) {
        await this.buildLedger.advance(
          checkpointed.generationBuildId,
          checkpointed.revision,
          "needs-attention"
        );
        throw new Error("Base GUI capability participant 未就绪");
      }
      decision = durable;
    } else {
      decision = await this.baseGuiGrants.createDecision({
        appId: plan.base.id,
        generationId: generation.generationId,
        contentDigest: generation.contentDigest,
        expectedActiveGenerationId: plan.previousActiveId,
        requestedCapabilities: plan.requestedBaseGuiCapabilities,
      });
    }
    if (!record.generationBinding.pending && decision.state === "approved") {
      return { record, operation };
    }
    const pending = record.generationBinding.pending ?? {
      generationId: generation.generationId,
      expectedActiveGenerationId: plan.previousActiveId,
      resolutionDigest: generation.contentDigest,
      packageGenerationReservationId: `base-gui:${generation.generationId}`,
      runtime: runtimeBinding(plan),
      consentDecisionId: decision.decisionId,
      expectedConsentRevision: decision.revision,
      state: "consent-required" as const,
    };
    const nextPending = {
      ...pending,
      baseGuiDecision: decisionPointer(decision),
      ...(record.generationBinding.pending
        ? { extensionState: record.generationBinding.pending.state }
        : {}),
    };
    nextPending.state = allParticipantsPromotable(nextPending)
      ? "ready-to-promote"
      : "consent-required";
    return {
      record: bindCapabilityPending(plan, generation, record, nextPending),
      operation,
    };
  }

  /**
   * 队列内重验：队列外预判过的那一代必须逐字段仍然成立，才允许把 target
   * epoch 整体 CAS 进 active binding。世界在等待期间变了就当场失败——
   * 让 cutover 走 abort，而不是把新代 binary 绑到一个别人的 epoch 上。
   */
  private bindPreparedEpoch(
    record: AppRecord,
    plan: NewGenerationPlan,
    prepared: PreparedServerCutover | null
  ): AppRecord {
    if (!needsServerEpoch(plan) || !this.serverCutover) return record;
    if (!prepared || prepared.generationId !== plan.generationId) {
      throw conflict("server data cutover 与本次 generation 不匹配");
    }
    return {
      ...record,
      generationBinding: {
        ...record.generationBinding,
        active: {
          generationId: plan.generationId,
          runtime: { kind: "server", dataEpochId: prepared.dataEpochId },
        },
      },
    };
  }

  private async commitRecord(
    next: AppRecord,
    appId: string,
    previous: AppRecord | undefined
  ) {
    if (next.generations.some((item) => item.contentLayoutVersion !== 2)) {
      throw new Error("AppStore 只允许提交 v2 generation");
    }
    appRecordSchema.parse(next);
    this.assertDerivedPaths([next]);
    this.records.set(appId, structuredClone(next));
    try {
      await this.persist();
    } catch (cause) {
      if (previous) this.records.set(appId, previous);
      else this.records.delete(appId);
      throw cause;
    }
    return this.get(appId)!;
  }

  private async beginBuild(plan: NewGenerationPlan) {
    if (!this.buildLedger) return null;
    return this.buildLedger.begin({
      generationBuildId: plan.generationBuildId,
      appId: plan.base.id,
      appGenerationId: plan.generationId,
      expectedActiveGenerationId: plan.previousActiveId,
      domainIdentity: plan.domainIdentity,
      runtime: runtimeBinding(plan),
      extensionRequirements: plan.declarations,
      ...(plan.manifest.kind === "base" &&
        this.baseGuiParticipant &&
        plan.requestedBaseGuiCapabilities.length > 0
        ? {
            baseGuiCapabilityRequest: {
              requestedCapabilities: plan.requestedBaseGuiCapabilities,
              contentDigest: plan.contentDigest,
            },
          }
        : {}),
    });
  }

  private async stageExtension(
    plan: NewGenerationPlan,
    operation: AppGenerationBuildOperation | null
  ) {
    const participant = this.participants?.require("app-extension");
    const extensions = this.extensions;
    if (!participant || !extensions || !operation || !this.buildLedger) {
      throw new Error(
        "含 extensionRequirements 的 generation 需要已注册的 App×Extension participant"
      );
    }
    const prepared = await participant.prepare(operation);
    let next = await this.buildLedger.checkpoint(
      operation.generationBuildId,
      operation.revision,
      prepared
    );
    const handoff =
      prepared.state === "prepared"
        ? extensions.handoff(operation.generationBuildId)
        : null;
    if (!handoff) {
      next = await this.buildLedger.advance(
        operation.generationBuildId,
        next.revision,
        "needs-attention"
      );
      throw new Error("App extension reservation 未就绪，build 保持 needs-attention");
    }
    const consent = await extensions.decide({
      appId: plan.base.id,
      frozenSet: handoff.frozenSet,
      deriveFromGenerationId: plan.previousActiveId,
    });
    const generation = sealGeneration(plan, {
      kind: "frozen",
      frozenSet: handoff.frozenSet,
      packageGenerationReservationId: handoff.reservationId,
    });
    return {
      record: bindPending(plan, generation, handoff, consent),
      operation: next,
    };
  }

  private async rollbackBuild(
    plan: NewGenerationPlan,
    operation: AppGenerationBuildOperation | null
  ) {
    if (operation) {
      await this.abortOperation(operation);
    } else if (plan.manifest.kind === "base" && this.baseGuiGrants) {
      await this.baseGuiGrants.revoke(plan.base.id, plan.generationId);
    }
    await this.discardArtifact(plan.base.id, plan.generationId);
  }

  private async abortGenerationBuild(
    appId: string,
    generation: AppGeneration
  ) {
    const operation = this.buildLedger
      ?.listNonTerminal(appId)
      .find(
        (item) => item.generationBuildId === generation.generationBuildId
      );
    if (!operation) {
      await this.baseGuiGrants?.revoke(appId, generation.generationId);
      return;
    }
    await this.abortOperation(operation);
  }

  /** 所有 participant 的 aborted checkpoint 都 durable 后，build 才能进入终态。 */
  private async abortOperation(operation: AppGenerationBuildOperation) {
    if (!this.buildLedger) throw new Error("generation build ledger 未配置");
    let next = operation;
    try {
      if (next.extensionRequirements.length > 0) {
        const aborted = await this.participants!
          .require("app-extension")
          .abort(next);
        next = await this.buildLedger.checkpoint(
          next.generationBuildId,
          next.revision,
          aborted
        );
      }
      if (next.baseGuiCapabilityRequest) {
        if (!this.baseGuiParticipant) {
          throw new Error("Base GUI participant 未配置");
        }
        const aborted = await this.baseGuiParticipant.abort(next);
        next = await this.buildLedger.checkpoint(
          next.generationBuildId,
          next.revision,
          aborted
        );
      }
      await this.buildLedger.advance(
        next.generationBuildId,
        next.revision,
        "aborted"
      );
    } catch (cause) {
      await this.buildLedger
        .advance(next.generationBuildId, next.revision, "needs-attention")
        .catch(() => {});
      throw cause;
    }
  }

  private async discardArtifact(appId: string, generationId: string) {
    const root = this.artifactRoot(appId, generationId);
    const trash = join(this.artifactsRoot, appId, `.trash-${randomUUID()}`);
    const moved = await rename(root, trash).then(
      () => true,
      (cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT") return false;
        throw cause;
      }
    );
    if (moved) await removePackageArtifact(trash);
  }

  /* 无待授权的新代 build 一路走到 promoted；Extension/Base GUI 任一仍 pending，
     就停在 ready-to-promote，等独立 promote 命令复核全部 decision 后才切 active。 */
  private async settleBuild(
    plan: NewGenerationPlan,
    operation: AppGenerationBuildOperation | null
  ) {
    if (operation && this.buildLedger) {
      let next = await this.buildLedger.advance(
        operation.generationBuildId,
        operation.revision,
        "generation-committed"
      );
      const pending = this.get(plan.base.id)?.generationBinding.pending;
      if (plan.declarations.length) {
        const committed = await this.participants!.require(
          "app-extension"
        ).finalize(next);
        next = await this.buildLedger.checkpoint(
          next.generationBuildId,
          next.revision,
          committed
        );
        if (committed.state !== "committed") {
          await this.buildLedger.advance(
            next.generationBuildId,
            next.revision,
            "needs-attention"
          );
          throw new Error("App extension reservation commit 未通过逐字节复核");
        }
      }
      if (next.baseGuiCapabilityRequest) {
        const committed = await this.baseGuiParticipant!.finalize(next);
        next = await this.buildLedger.checkpoint(
          next.generationBuildId,
          next.revision,
          committed
        );
        if (committed.state !== "committed") {
          await this.buildLedger.advance(
            next.generationBuildId,
            next.revision,
            "needs-attention"
          );
          throw new Error("Base GUI capability decision commit 未通过 exact 复核");
        }
      }
      next = await this.buildLedger.advance(
        next.generationBuildId,
        next.revision,
        "ready-to-promote"
      );
      if (!pending) {
        await this.buildLedger.advance(
          next.generationBuildId,
          next.revision,
          "promoted"
        );
      }
    }
  }

  private assertDerivedPaths(records: AppRecord[]) {
    for (const record of records) {
      const expected = normalize(join(this.appsRoot, record.id));
      if (
        !isAbsolute(record.dir) ||
        normalize(record.dir) !== expected ||
        relative(this.appsRoot, expected).startsWith("..")
      ) {
        throw new Error(`App ${record.id} 的目录不受 userData/apps 管理`);
      }
    }
  }

  private async persist() {
    const content = JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        apps: this.list(),
        retiredIds: [...this.retiredIds].sort(),
      },
      null,
      2
    );
    await durableReplaceFile(this.filePath, `${content}\n`);
  }
}

/* ── generation 三步：先算身份，再按有无声明分别封 active / pending ────────── */

type NewGenerationPlan = Readonly<{
  base: AppRecord;
  manifest: AppManifest;
  domainIdentity: AppDomainIdentity;
  contentDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  sourcePackageDigest: Sha256Digest;
  digests: PackageDigestSet;
  generationId: string;
  generationBuildId: string;
  declarations: readonly AppExtensionRequirementDeclaration[];
  requestedBaseGuiCapabilities: readonly BaseGuiCapability[];
  previousActiveId: string | null;
  previousManifest: AppManifest | null;
  sourceDir: string;
}>;

/** `migrationId` = Extension 换代的 durable 幂等身份。 */
type GenerationPlanOptions = Readonly<{
  migrationId?: string;
  sourceDir?: string;
  identitySuffix?: string;
}>;

function generationDigests(generation: AppGeneration): PackageDigestSet {
  if (!generation.manifestDigest || !generation.sourcePackageDigest) {
    throw new Error("generation v2 digest 不完整");
  }
  return {
    manifestDigest: generation.manifestDigest,
    sourcePackageDigest: generation.sourcePackageDigest,
    contentDigest: generation.contentDigest,
  };
}

async function planGeneration(
  record: AppRecord,
  previous: AppRecord | undefined,
  options: GenerationPlanOptions = {}
): Promise<NewGenerationPlan | null> {
  if (!record.manifest) return null;
  const migrationSuffix = options.migrationId
    ? digest(options.migrationId).slice(-16)
    : null;
  const migrationBuildId = migrationSuffix
    ? `build-${record.id}-extension-${migrationSuffix}`
    : null;
  /* App 已经落下这次迁移的 generation：重放直接返回当前
     record，绝不因「通知账本 checkpoint 晚了一拍」再生一代。 */
  if (
    migrationBuildId &&
    record.generations.some(
      (generation) => generation.generationBuildId === migrationBuildId
    )
  ) {
    return null;
  }
  const active = record.generations.find(
    (generation) =>
      generation.generationId === record.generationBinding.active?.generationId
  );
  const nextDomainIdentity = domainIdentity(record.manifest);
  if (
    previous?.domainIdentity &&
    JSON.stringify(previous.domainIdentity) !== JSON.stringify(nextDomainIdentity)
  ) {
    throw new Error("APP_DOMAIN_IDENTITY_CHANGE_REQUIRES_NEW_ID");
  }
  const sourceDir = options.sourceDir ?? record.dir;
  const digests = await inspectPackageDigests(sourceDir, record.manifest);
  if (
    !options.migrationId &&
    active?.manifestDigest === digests.manifestDigest &&
    active.contentDigest === digests.contentDigest
  ) {
    return null;
  }
  const contentDigest = digests.contentDigest;
  const generationOrdinal = record.lifecycleRevision + 1;
  const identitySuffix = options.identitySuffix
    ? `-a${options.identitySuffix}`
    : "";
  return {
    base: record,
    manifest: record.manifest,
    domainIdentity: nextDomainIdentity,
    contentDigest,
    manifestDigest: digests.manifestDigest,
    sourcePackageDigest: digests.sourcePackageDigest,
    digests,
    /* 迁移代的身份必须与内容摘要脱钩：内容没变正是迁移最常见的形态，
       沿用 digest 派生的 id 会撞上同一代，从而变成「原地换绑」。 */
    generationId: migrationSuffix
      ? `${record.id}-g${generationOrdinal}-${contentDigest.slice(-12)}-m${migrationSuffix}`
      : `${record.id}-g${generationOrdinal}-${contentDigest.slice(-12)}${identitySuffix}`,
    generationBuildId:
      migrationBuildId ??
      `build-${record.id}-${record.lifecycleRevision + 1}${identitySuffix}`,
    declarations: record.manifest.extensionRequirements ?? [],
    requestedBaseGuiCapabilities: requestedBaseGuiCapabilities(record.manifest),
    previousActiveId: previous?.generationBinding.active?.generationId ?? null,
    previousManifest: previous?.manifest ?? null,
    sourceDir,
  };
}

function sealGeneration(
  plan: NewGenerationPlan,
  extensionRequirementResolution: AppExtensionResolutionBinding
): AppGeneration {
  return {
    generationId: plan.generationId,
    generationBuildId: plan.generationBuildId,
    manifestDigest: plan.manifestDigest,
    sourcePackageDigest: plan.sourcePackageDigest,
    contentDigest: plan.contentDigest,
    manifest: structuredClone(plan.manifest),
    extensionRequirementResolution,
    contentLayoutVersion: 2,
    createdAt: Date.now(),
  };
}

function runtimeBinding(plan: NewGenerationPlan): AppGenerationRuntimeBinding {
  /* pending 分支上的这个 id 是占位而非写根：只有 cutover 现造的 epoch 才会
     进入 active binding（见 bindPreparedEpoch / promoteBinding）。 */
  return plan.manifest.kind === "server"
    ? { kind: "server", dataEpochId: `data-${plan.generationId}` }
    : { kind: "none" };
}

/** 只有「这一代马上就要成为 active server writer」才需要 data epoch 切换。 */
function needsServerEpoch(plan: NewGenerationPlan) {
  return plan.manifest.kind === "server" && plan.declarations.length === 0;
}

function bindActive(plan: NewGenerationPlan, generation: AppGeneration): AppRecord {
  const binding = plan.base.generationBinding;
  return {
    ...plan.base,
    lifecycleRevision: plan.base.lifecycleRevision + 1,
    domainIdentity: plan.domainIdentity,
    generations: [...plan.base.generations, generation],
    generationBinding: {
      bindingRevision: binding.bindingRevision + 1,
      active: { generationId: generation.generationId, runtime: runtimeBinding(plan) },
      drainingGenerationIds: plan.previousActiveId
        ? [...new Set([...binding.drainingGenerationIds, plan.previousActiveId])]
        : binding.drainingGenerationIds,
    },
  };
}

function promoteBinding(
  record: AppRecord,
  generation: AppGeneration,
  pending: NonNullable<AppRecord["generationBinding"]["pending"]>,
  dataEpochId?: string
): AppRecord {
  const previousActiveId = record.generationBinding.active?.generationId;
  /* pending 上那条 `dataEpochId` 只是占位：真正的写根由本次 cutover 现造，
     promote 这一刻才第一次成为可写事实。 */
  const runtime =
    pending.runtime.kind === "server" && dataEpochId
      ? ({ kind: "server", dataEpochId } as const)
      : pending.runtime;
  return {
    ...record,
    lifecycleRevision: record.lifecycleRevision + 1,
    manifest: structuredClone(generation.manifest),
    generationBinding: {
      bindingRevision: record.generationBinding.bindingRevision + 1,
      active: { generationId: generation.generationId, runtime },
      drainingGenerationIds: previousActiveId
        ? [
            ...new Set([
              ...record.generationBinding.drainingGenerationIds,
              previousActiveId,
            ]),
          ]
        : record.generationBinding.drainingGenerationIds,
    },
  };
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}

/* pending 代不是 active：manifest 投影必须停在旧代，否则 DTO 会宣称尚未授权的字节
   已经生效。首装因此是 active=null + manifest=null，直到 promote。 */
function bindPending(
  plan: NewGenerationPlan,
  generation: AppGeneration,
  handoff: AppExtensionGenerationHandoff,
  consent: AppExtensionGenerationConsent
): AppRecord {
  const binding = plan.base.generationBinding;
  return {
    ...plan.base,
    lifecycleRevision: plan.base.lifecycleRevision + 1,
    domainIdentity: plan.domainIdentity,
    manifest: plan.previousManifest,
    generations: [...plan.base.generations, generation],
    generationBinding: {
      bindingRevision: binding.bindingRevision + 1,
      active: binding.active,
      pending: {
        generationId: generation.generationId,
        expectedActiveGenerationId: plan.previousActiveId,
        resolutionDigest: handoff.frozenSet.resolutionDigest,
        packageGenerationReservationId: handoff.reservationId,
        runtime: runtimeBinding(plan),
        ...consent,
      },
      drainingGenerationIds: binding.drainingGenerationIds,
    },
  };
}

type PendingGeneration = NonNullable<
  AppRecord["generationBinding"]["pending"]
>;

function decisionPointer(decision: BaseGuiCapabilityDecision) {
  return {
    decisionId: decision.decisionId,
    expectedRevision: decision.revision,
    requestedCapabilities: decision.requestedCapabilities,
    state: decision.state,
  } as const;
}

function allParticipantsPromotable(pending: PendingGeneration) {
  const extensionReady =
    !pending.extensionState || pending.extensionState === "ready-to-promote";
  const baseGuiReady =
    !pending.baseGuiDecision || pending.baseGuiDecision.state === "approved";
  return extensionReady && baseGuiReady;
}

function bindCapabilityPending(
  plan: NewGenerationPlan,
  generation: AppGeneration,
  staged: AppRecord,
  pending: PendingGeneration
): AppRecord {
  if (staged.generationBinding.pending) {
    return {
      ...staged,
      generationBinding: { ...staged.generationBinding, pending },
    };
  }
  const binding = plan.base.generationBinding;
  return {
    ...plan.base,
    lifecycleRevision: plan.base.lifecycleRevision + 1,
    domainIdentity: plan.domainIdentity,
    manifest: plan.previousManifest,
    generations: [...plan.base.generations, generation],
    generationBinding: {
      bindingRevision: binding.bindingRevision + 1,
      active: binding.active,
      pending,
      drainingGenerationIds: binding.drainingGenerationIds,
    },
  };
}
