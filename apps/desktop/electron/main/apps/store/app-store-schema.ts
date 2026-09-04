/**
 * [INPUT]: Depends on zod, shared App/agent contracts, and the App manifest schema
 * [OUTPUT]: Provides the v15-only apps.json contract, static-v2/compiled-v3 generation discrimination, one shared chat-slot identity for Edit/Use/switch, a strict fail-closed parser, locale-independent byte-ordered canonical manifest digest, and domain identity projection
 * [POS]: AppStore persistence contract; storage and generation orchestration consume this fail-closed schema instead of defining it inline, while the quarantine decision for foreign bytes stays in app-store.ts
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { agentBackendIdSchema } from "../../../../shared/agent-schema";
import type { AppManifest } from "../../../../shared/apps-ipc";
import { appManifestSchema } from "../install/manifest-schema";

export const SCHEMA_VERSION = 15;
export const APP_ID_PATTERN = /^[a-z0-9]{10}$/;
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
      declaredComponentIdentity: z.string().min(1),
      componentInstanceIdentity: z.string().min(1),
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
      declaredComponentIdentity: z.string().min(1),
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
    visibleInventoryVersion: z.string().min(1),
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
const generationV2Schema = z
  .object({
    generationId: z.string().min(1),
    generationBuildId: z.string().min(1),
    manifestDigest: digestSchema,
    sourcePackageDigest: digestSchema,
    contentDigest: digestSchema,
    compatibilityRefDigest: digestSchema.optional(),
    compatibilityRef: z
      .object({
        kind: z.literal("static-v2"),
        legacySdkDigest: digestSchema,
        legacyBaseApiVersion: z.literal("base-gui-legacy-v1"),
        grantContractVersion: z.literal("studio-grant-v1"),
        requiredHostActions: z.array(z.enum(["open-data", "open-data-view", "compose-text"])).max(3),
      })
      .strict()
      .optional(),
    manifest: appManifestSchema,
    extensionRequirementResolution: extensionResolutionSchema,
    contentLayoutVersion: z.literal(2),
    createdAt: z.number().int().nonnegative(),
    retiredAt: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((generation, context) => {
    if (Boolean(generation.compatibilityRefDigest) !== Boolean(generation.compatibilityRef)) {
      context.addIssue({ code: "custom", path: ["compatibilityRef"], message: "static-v2 compatibility ref 必须成对持久化" });
    }
    if (
      generation.compatibilityRef &&
      generation.compatibilityRefDigest !== digest(generation.compatibilityRef)
    ) {
      context.addIssue({ code: "custom", path: ["compatibilityRefDigest"], message: "static-v2 compatibility ref digest 不匹配" });
    }
  });
const compiledCompatibilityRefSchema = z
  .object({
    kind: z.literal("compiled-v3"),
    transformContractDigest: digestSchema,
    sdkDigest: digestSchema,
    cutoverContractVersion: z.literal("app-generation-cutover-v2"),
    dataSdk: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }).strict(),
      z.object({ kind: z.literal("base-gui-data-v1"), querySemanticsVersion: z.literal("base-gui-query-v1") }).strict(),
    ]),
    preferences: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }).strict(),
      z.object({ kind: z.literal("app-preferences-v1"), schemaDigest: digestSchema, defaultsDigest: digestSchema }).strict(),
    ]),
    workspace: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }).strict(),
      z.object({ kind: z.literal("workspace-read-v1"), scope: z.literal("design/"), opaquePreviewContractVersion: z.literal("workspace-opaque-preview-v1") }).strict(),
    ]),
    hostActions: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }).strict(),
      z.object({
        kind: z.literal("host-actions-v1"),
        required: z.array(z.enum(["open-data", "open-data-view", "compose-text", "file.export"])).max(4),
      }).strict(),
    ]),
  })
  .strict();
const generationV3Schema = z
  .object({
    generationId: z.string().min(1),
    generationBuildId: z.string().min(1),
    manifestDigest: digestSchema,
    sourcePackageDigest: digestSchema,
    contentDigest: digestSchema,
    buildReceiptDigest: digestSchema,
    compatibilityRefDigest: digestSchema,
    compatibilityRef: compiledCompatibilityRefSchema,
    manifest: appManifestSchema,
    extensionRequirementResolution: extensionResolutionSchema,
    contentLayoutVersion: z.literal(3),
    createdAt: z.number().int().nonnegative(),
    retiredAt: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((generation, context) => {
    if (generation.compatibilityRefDigest !== digest(generation.compatibilityRef)) {
      context.addIssue({
        code: "custom",
        path: ["compatibilityRefDigest"],
        message: "compiled-v3 compatibility ref digest 不匹配",
      });
    }
  });
/* v1 只允许 load 后立刻 restage；所有 commit 都由 commitRecord 的 v2 guard 拦住。 */
const generationSchema = z.discriminatedUnion("contentLayoutVersion", [
  generationV2Schema,
  generationV3Schema,
]);
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
              z.enum(["row-insert", "row-patch", "row-delete", "attachment-read", "workspace-read"])
            ).max(5),
            requestedHostActions: z.array(z.enum(["compose-text", "file.export"])).max(2).default([]),
            requestedCapabilityScopes: z
              .object({ workspaceRead: z.literal("design/").optional() })
              .strict()
              .default({}),
            compatibilityRefDigest: digestSchema.optional(),
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

/* Edit/Use 槽位与 App Use switch 的 source/target 是同一种身份，一份 schema 说到底。 */
const appChatSlotSchema = z
  .object({
    id: z.string().min(1).max(128),
    incarnationId: z.string().min(1).max(256),
    state: z.enum(["draft", "canonical"]),
    revision: z.number().int().positive(),
  })
  .strict();

const editorProjectionSchema = z
  .object({
    editorActivatedAt: z.number().int().nonnegative().nullable(),
    editorHiddenAt: z.number().int().nonnegative().nullable(),
    editorRevision: z.number().int().nonnegative(),
  })
  .strict();

const sourceStateSchema = z
  .object({
    sourceRevision: z.number().int().nonnegative(),
    fingerprint: z.string().min(1).max(512).nullable(),
    lastReconciledAt: z.number().int().nonnegative().nullable(),
  })
  .strict();

const appUseSwitchSchema = z
  .object({
    intentId: z.string().min(1).max(256),
    appId: z.string().regex(APP_ID_PATTERN),
    source: appChatSlotSchema.nullable(),
    target: appChatSlotSchema,
    expectedAppRevision: z.number().int().nonnegative(),
    expectedLifecycleRevision: z.number().int().nonnegative().default(0),
    expectedGenerationBindingRevision: z.number().int().nonnegative().default(0),
    expectedGenerationId: z.string().min(1).max(256).nullable().default(null),
    expectedSourceSurfaceRevision: z.number().int().nonnegative().default(0),
    expectedTargetSurfaceRevision: z.number().int().nonnegative().default(0),
    expectedStudioSurfaceRevision: z.number().int().nonnegative().default(0),
    phase: z.enum([
      "prepared",
      "committed",
      "old-revoked",
      "old-drained",
      "target-claimed",
      "issuance-open",
      "completed",
    ]),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export const appRecordSchema = z
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
    studioGrant: z
      .object({
        appId: z.string().regex(APP_ID_PATTERN),
        generationId: z.string().min(1),
        contentDigest: digestSchema,
        data: z
          .object({ kind: z.literal("base"), level: z.enum(["read", "row-write"]) })
          .strict(),
        agentDelegation: z
          .object({ fileRead: z.literal(false), useData: z.literal(false) })
          .strict(),
        baseGuiDecisionId: z.string().uuid().nullable(),
        baseGuiDecisionRevision: z.number().int().nonnegative(),
        compatibilityRefDigest: digestSchema.optional(),
        grantedAt: z.number().int().nonnegative(),
      })
      .strict()
      .nullable()
      .default(null),
    studioGrantRevision: z.number().int().nonnegative().default(0),
    pinnedAt: z.number().int().nonnegative().nullable(),
    domainIdentity: domainIdentitySchema.nullable(),
    generations: z.array(generationSchema),
    generationBinding: generationBindingSchema,
    manifest: appManifestSchema.nullable(),
    editChatSlot: appChatSlotSchema.nullable(),
    activeUseChatSlot: appChatSlotSchema.nullable(),
    editor: editorProjectionSchema.default({
      editorActivatedAt: null,
      editorHiddenAt: null,
      editorRevision: 0,
    }),
    activeUseSwitch: appUseSwitchSchema.nullable().default(null),
    sourceState: sourceStateSchema.default({
      sourceRevision: 0,
      fingerprint: null,
      lastReconciledAt: null,
    }),
    editableSource: z.boolean(),
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
    const studioGrant = record.studioGrant;
    const studioGeneration = record.generations.find(
      (generation) => generation.generationId === studioGrant?.generationId
    );
    if (
      studioGrant &&
      (studioGrant.appId !== record.id ||
        !studioGeneration ||
        studioGeneration.contentDigest !== studioGrant.contentDigest)
    ) {
      context.addIssue({
        code: "custom",
        path: ["studioGrant"],
        message: "Studio grant 必须绑定本 App 的 exact generation/content digest",
      });
    }
  });

export const storeSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    apps: z.array(appRecordSchema).max(100),
    retiredIds: z
      .array(z.string().regex(APP_ID_PATTERN))
      .max(10_000)
      .default([]),
  })
  .strict();

export type StoreFile = z.infer<typeof storeSchema>;

/* apps.json 只认 v15：断代不是迁移，非本版字节由 AppStore 隔离留证后按空目录冷启动。 */
export function parseStore(raw: unknown): StoreFile {
  return storeSchema.parse(raw);
}

export function digest(value: unknown): `sha256:${string}` {
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

/**
 * digest 的唯一排序依据必须是字节序：localeCompare 走进程 locale 与 ICU 版本，
 * 同一份数据在两台机器上可能排出两种顺序，digest 也就跟着分叉。与
 * gui-build/metadata.ts 的 canonicalJson 是同一套规则的孪生实现（两边各自本地
 * 持有，互不 import，避免持久化契约反向依赖构建管线）。
 * 当前 key 全是小写 ASCII，字节序与 localeCompare 结果一致，已有数据的 digest
 * 不变。
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function domainIdentity(manifest: AppManifest) {
  if (manifest.kind === "static" || manifest.kind === "server") {
    return { kind: "no-data" as const, appKind: manifest.kind };
  }
  return { kind: "base" as const, domain: { kind: "ordinary" as const } };
}
