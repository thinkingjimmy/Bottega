/**
 * [INPUT]: Depends on zod, shared App/agent contracts, and the App manifest schema
 * [OUTPUT]: Provides the apps.json v12/v11 schemas, strict migration parser, canonical manifest digest, and domain identity projection
 * [POS]: AppStore persistence contract; storage and generation orchestration consume this fail-closed schema instead of defining it inline
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { agentBackendIdSchema } from "../../../shared/agent-schema";
import type { AppManifest } from "../../../shared/apps-ipc";
import { appManifestSchema } from "./install/manifest-schema";

export const SCHEMA_VERSION = 12;
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
              z.enum(["row-insert", "row-patch", "row-delete", "attachment-read", "workspace-read"])
            ).max(5),
            requestedHostActions: z.array(z.enum(["compose-text"])).max(1).default([]),
            requestedCapabilityScopes: z
              .object({ workspaceRead: z.literal("design/").optional() })
              .strict()
              .default({}),
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
    openModeOverride: z
      .enum(["same-window", "new-window"])
      .nullable()
      .default(null),
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

export const storeSchema = z
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

export type StoreFile = z.infer<typeof storeSchema>;

export const legacyStoreSchema = z
  .object({
    schemaVersion: z.literal(11),
    apps: z.array(appRecordSchema).max(100),
    retiredIds: z.array(z.string().regex(APP_ID_PATTERN)).max(10_000).default([]),
  })
  .strict();

export const legacyMigrationCheckpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    pendingAppIds: z.array(z.string().regex(APP_ID_PATTERN)).max(100),
  })
  .strict();
export type LegacyMigrationCheckpoint = z.infer<
  typeof legacyMigrationCheckpointSchema
>;

/** v11 是唯一迁移入口；其 shape 先完整验真，再由 load 备份并 restage。
 *  其它旧版/未来版一律抛错，不猜逐版本语义——由 load 备份 `.bak` 后隔离，
 *  按空态冷启动继续（启动不崩，App 重装即可）。 */
export function parseStore(raw: unknown): { file: StoreFile; legacy: boolean } {
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

export function domainIdentity(manifest: AppManifest) {
  if (manifest.kind === "static" || manifest.kind === "server") {
    return { kind: "no-data" as const, appKind: manifest.kind };
  }
  return { kind: "base" as const, domain: { kind: "ordinary" as const } };
}
