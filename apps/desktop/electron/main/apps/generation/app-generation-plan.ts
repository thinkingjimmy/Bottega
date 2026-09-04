/**
 * [INPUT]: Depends on sealed package digests, shared App/Extension contracts, and canonical App schema identities
 * [OUTPUT]: Provides pure generation planning, static-v2/compiled-v3 compatibility sealing, pending/active binding, promotion, and capability-decision projection
 * [POS]: Immutable App generation planning kernel; AppStore owns serialization and durable participant orchestration
 */

import type {
  AppDomainIdentity,
  AppExtensionResolutionBinding,
  AppGeneration,
  AppGenerationRuntimeBinding,
  AppManifest,
  AppRecord,
  BaseGuiCapabilityDecision,
  BaseGuiCapability,
  BaseGuiCapabilityScopes,
  BaseGuiHostActionCapability,
} from "../../../../shared/apps-ipc";
import {
  requestedBaseGuiCapabilities,
  requestedBaseGuiCapabilityScopes,
  requestedBaseGuiHostActions,
} from "../../../../shared/apps-ipc";
import type { AppExtensionRequirementDeclaration, Sha256Digest } from "../../../../shared/extensions-ipc";
import type { AppExtensionGenerationConsent, AppExtensionGenerationHandoff } from "./app-extension-generation";
import type { PreparedCompiledAppGui } from "../gui-build/service";
import { LEGACY_BASE_GUI_SDK_DIGEST } from "../gui-build/metadata";
import { inspectPackageDigests, type PackageDigestSet } from "../share/package/package-contract";
import { digest, domainIdentity } from "../store/app-store-schema";

/* ── generation 三步：先算身份，再按有无声明分别封 active / pending ────────── */

export type NewGenerationPlan = Readonly<{
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
  requestedBaseGuiHostActions: readonly BaseGuiHostActionCapability[];
  requestedBaseGuiCapabilityScopes: BaseGuiCapabilityScopes;
  previousActiveId: string | null;
  previousManifest: AppManifest | null;
  sourceDir: string;
  compiled: PreparedCompiledAppGui | null;
}>;

/** `migrationId` = Extension 换代的 durable 幂等身份。 */
export type GenerationPlanOptions = Readonly<{
  migrationId?: string;
  sourceDir?: string;
  identitySuffix?: string;
  compiled?: PreparedCompiledAppGui;
}>;

export function generationDigests(generation: AppGeneration): PackageDigestSet {
  return {
    manifestDigest: generation.manifestDigest,
    sourcePackageDigest: generation.sourcePackageDigest,
    contentDigest: generation.contentDigest,
  };
}

export async function planGeneration(
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
  const sourceDir = options.compiled?.source.snapshotRoot ?? options.sourceDir ?? record.dir;
  const digests = options.compiled
    ? {
        manifestDigest: options.compiled.digests.manifestDigest,
        sourcePackageDigest: options.compiled.digests.sourcePackageDigest,
        contentDigest: options.compiled.digests.contentDigest,
      }
    : await inspectPackageDigests(sourceDir, record.manifest);
  const expectsCompiled = record.manifest.kind === "base" && Boolean(record.manifest.gui?.build);
  if (expectsCompiled !== Boolean(options.compiled)) {
    throw new Error(expectsCompiled
      ? "compiled GUI generation requires a prepared sandbox artifact"
      : "static generation cannot consume a compiled GUI artifact");
  }
  if (
    !options.migrationId &&
    active?.manifestDigest === digests.manifestDigest &&
    active.sourcePackageDigest === digests.sourcePackageDigest &&
    active.contentDigest === digests.contentDigest &&
    (!options.compiled || active.buildReceiptDigest === options.compiled.buildReceiptDigest)
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
    requestedBaseGuiHostActions: requestedBaseGuiHostActions(record.manifest),
    requestedBaseGuiCapabilityScopes: requestedBaseGuiCapabilityScopes(record.manifest),
    previousActiveId: previous?.generationBinding.active?.generationId ?? null,
    previousManifest: previous?.manifest ?? null,
    sourceDir,
    compiled: options.compiled ?? null,
  };
}

export function sealGeneration(
  plan: NewGenerationPlan,
  extensionRequirementResolution: AppExtensionResolutionBinding
): AppGeneration {
  const compiled = plan.compiled;
  const staticGui = !compiled && plan.manifest.kind === "base" && plan.manifest.gui
    ? {
        kind: "static-v2" as const,
        legacySdkDigest: LEGACY_BASE_GUI_SDK_DIGEST,
        legacyBaseApiVersion: "base-gui-legacy-v1" as const,
        grantContractVersion: "studio-grant-v1" as const,
        requiredHostActions: [
          "open-data" as const,
          "open-data-view" as const,
          ...(plan.manifest.gui.hostActions?.includes("compose-text")
            ? ["compose-text" as const]
            : []),
        ],
      }
    : null;
  return {
    generationId: plan.generationId,
    generationBuildId: plan.generationBuildId,
    manifestDigest: plan.manifestDigest,
    sourcePackageDigest: plan.sourcePackageDigest,
    contentDigest: plan.contentDigest,
    ...(compiled
      ? {
          buildReceiptDigest: compiled.buildReceiptDigest,
          compatibilityRefDigest: digest(compiled.receipt.compatibility),
          compatibilityRef: structuredClone(compiled.receipt.compatibility),
        }
      : staticGui
        ? {
            compatibilityRefDigest: digest(staticGui),
            compatibilityRef: staticGui,
          }
        : {}),
    manifest: structuredClone(plan.manifest),
    extensionRequirementResolution,
    contentLayoutVersion: compiled ? 3 : 2,
    createdAt: Date.now(),
  };
}

export function runtimeBinding(plan: NewGenerationPlan): AppGenerationRuntimeBinding {
  /* pending 分支上的这个 id 是占位而非写根：只有 cutover 现造的 epoch 才会
     进入 active binding（见 bindPreparedEpoch / promoteBinding）。 */
  return plan.manifest.kind === "server"
    ? { kind: "server", dataEpochId: `data-${plan.generationId}` }
    : { kind: "none" };
}

/** 只有「这一代马上就要成为 active server writer」才需要 data epoch 切换。 */
export function needsServerEpoch(plan: NewGenerationPlan) {
  return plan.manifest.kind === "server" && plan.declarations.length === 0;
}

export function bindActive(plan: NewGenerationPlan, generation: AppGeneration): AppRecord {
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

export function promoteBinding(
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

export function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}

/* pending 代不是 active：manifest 投影必须停在旧代，否则 DTO 会宣称尚未授权的字节
   已经生效。首装因此是 active=null + manifest=null，直到 promote。 */
export function bindPending(
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

export function decisionPointer(decision: BaseGuiCapabilityDecision) {
  return {
    decisionId: decision.decisionId,
    expectedRevision: decision.revision,
    requestedCapabilities: decision.requestedCapabilities,
    requestedHostActions: decision.requestedHostActions,
    requestedCapabilityScopes: decision.requestedCapabilityScopes,
    ...(decision.compatibilityRefDigest
      ? { compatibilityRefDigest: decision.compatibilityRefDigest }
      : {}),
    state: decision.state,
  } as const;
}

export function allParticipantsPromotable(pending: PendingGeneration) {
  const extensionReady =
    !pending.extensionState || pending.extensionState === "ready-to-promote";
  const baseGuiReady =
    !pending.baseGuiDecision || pending.baseGuiDecision.state === "approved";
  return extensionReady && baseGuiReady;
}

export function bindCapabilityPending(
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
