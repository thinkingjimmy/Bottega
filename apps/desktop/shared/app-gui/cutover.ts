/**
 * [INPUT]: Depends on zod and shared SHA-256 digest primitives
 * [OUTPUT]: Provides strict App-global cutover journal, cohort, and side-effect permit contracts with independent App CAS and previous-GUI authority identities, absolute-time barrier deadlines, and no persisted mirror of the live side-effect fence
 * [POS]: Shared app-gui cutover state machine; main persists the journal as a write-ahead intent ledger while the AppStore active CAS stays the single commit point, including first-GUI activation over an existing non-GUI App generation
 */

import { z } from "zod";
import type { Sha256Digest } from "../extensions-ipc";

const digestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/)
  .transform((value) => value as Sha256Digest);
const idSchema = z.string().trim().min(1).max(200);

export const GUI_STAGING_OPERATIONS = [
  "bootstrap.first-paint",
  "base.meta",
  "base.query-v1",
  "attachment.read",
  "base.revision-event",
  "preferences.preview",
  "workspace.files",
  "workspace.versions",
  "workspace.source-line",
  "workspace.opaque-preview",
] as const;

export const GUI_SIDE_EFFECT_KINDS = [
  "legacy-base-mutation",
  "legacy-navigation",
  "legacy-compose-text",
  "base-mutation",
  "preferences-write",
  "preferences-adopt",
  "host-navigation",
  "host-compose-text",
  "file-export",
] as const;

export type GuiStagingOperationV1 = (typeof GUI_STAGING_OPERATIONS)[number];
export type GuiSideEffectKindV1 = (typeof GUI_SIDE_EFFECT_KINDS)[number];

export const GUI_CUTOVER_PARTICIPANT_IDS = [
  "core-projection-v1",
  "core-bootstrap-v1",
  "legacy-side-effects-v1",
  "base-query-v1",
  "base-revision-event-v1",
  "base-mutation-v1",
  "preferences-v1",
  "workspace-read-v1",
  "host-actions-v1",
  "file-export-v1",
] as const;

export type GuiCutoverParticipantIdV1 =
  (typeof GUI_CUTOVER_PARTICIPANT_IDS)[number];
export type GuiCutoverParticipantPlanEntry = Readonly<{
  participantId: GuiCutoverParticipantIdV1;
  contractVersion: string;
  scope: "app" | "surface" | "app-and-surface";
  stagingOperations: readonly GuiStagingOperationV1[];
  sideEffectKinds: readonly GuiSideEffectKindV1[];
}>;
export type GuiCutoverParticipantEvidence = Readonly<{
  participantId: GuiCutoverParticipantIdV1;
  evidenceDigest: Sha256Digest;
}>;

export type AppGuiGenerationAuthorityRef = Readonly<{
  generationId: string;
  contentDigest: Sha256Digest;
  compatibilityRefDigest: Sha256Digest;
  decisionId: string | null;
  grantId: string | null;
}>;

export type AppGuiPreferenceAdoptionSnapshot = Readonly<{
  profileId: "local";
  expectedStoreRevision: number;
  fromSchemaDigest: Sha256Digest | null;
  targetSchemaDigest: Sha256Digest;
  defaultsDigest: Sha256Digest;
}>;

export type AppGuiGenerationIntent = Readonly<{
  cutoverId: string;
  appId: string;
  expectedActiveGenerationId: string | null;
  nextGenerationId: string;
  previous: AppGuiGenerationAuthorityRef | null;
  next: AppGuiGenerationAuthorityRef;
  participantPlan: readonly GuiCutoverParticipantPlanEntry[];
  participantPlanDigest: Sha256Digest;
  appParticipantEvidence: readonly GuiCutoverParticipantEvidence[];
  preferenceAdoption: AppGuiPreferenceAdoptionSnapshot | null;
  phase:
    | "prepared"
    | "staging"
    | "cohort-frozen"
    | "participants-ready"
    | "admission-closing"
    | "active"
    | "draining"
    | "retired"
    | "aborted";
  revision: number;
  /* 绝对墙钟时刻（epoch ms），不是时长：deadline 在真正开始等待的那一刻盖章，
     否则 barrier 会继承前面阶段已经花掉的预算。 */
  readyDeadlineAt: number;
  drainDeadlineAt: number;
}>;

export type AppGuiSurfaceTransitionMember = Readonly<{
  logicalSurfaceId: string;
  mode: "chat-tab" | "studio";
  previousRuntimeSurfaceId: string | null;
  previousLeaseId: string | null;
  stagedRuntimeSurfaceId: string;
  stagingLeaseId: string | null;
  readyEvidenceDigest: Sha256Digest | null;
  /* 成员只有四态：冻结前入列的 staging、投票后的 ready、随时可能的 closed，
     以及提交后的 swapped。没有 failed——成员失败没有信道能送达 main，
     真正的失败信号是 ready deadline；也没有 joining——冻结后不再有人入列。 */
  state: "staging" | "ready" | "closed" | "swapped";
}>;

export type AppGuiSurfaceTransitionCohort = Readonly<{
  cutoverId: string;
  revision: number;
  admission: "collecting" | "frozen" | "closed";
  frozenRevision: number | null;
  members: readonly AppGuiSurfaceTransitionMember[];
}>;

const authoritySchema = z
  .object({
    generationId: idSchema,
    contentDigest: digestSchema,
    compatibilityRefDigest: digestSchema,
    decisionId: idSchema.nullable(),
    grantId: idSchema.nullable(),
  })
  .strict();

const preferenceAdoptionSchema = z.object({
  profileId: z.literal("local"),
  expectedStoreRevision: z.number().int().nonnegative(),
  fromSchemaDigest: digestSchema.nullable(),
  targetSchemaDigest: digestSchema,
  defaultsDigest: digestSchema,
}).strict();

export const guiCutoverParticipantPlanEntrySchema: z.ZodType<GuiCutoverParticipantPlanEntry> = z
  .object({
    participantId: z.enum(GUI_CUTOVER_PARTICIPANT_IDS),
    contractVersion: idSchema,
    scope: z.enum(["app", "surface", "app-and-surface"]),
    stagingOperations: z.array(z.enum(GUI_STAGING_OPERATIONS)).max(GUI_STAGING_OPERATIONS.length),
    sideEffectKinds: z.array(z.enum(GUI_SIDE_EFFECT_KINDS)).max(GUI_SIDE_EFFECT_KINDS.length),
  })
  .strict()
  .superRefine((entry, context) => {
    if (new Set(entry.stagingOperations).size !== entry.stagingOperations.length) {
      context.addIssue({ code: "custom", path: ["stagingOperations"], message: "participant staging operations must be unique" });
    }
    if (new Set(entry.sideEffectKinds).size !== entry.sideEffectKinds.length) {
      context.addIssue({ code: "custom", path: ["sideEffectKinds"], message: "participant side effects must be unique" });
    }
  });

const participantEvidenceSchema: z.ZodType<GuiCutoverParticipantEvidence> = z.object({
  participantId: z.enum(GUI_CUTOVER_PARTICIPANT_IDS),
  evidenceDigest: digestSchema,
}).strict();

export const appGuiGenerationIntentSchema: z.ZodType<AppGuiGenerationIntent> = z
  .object({
    cutoverId: idSchema,
    appId: idSchema,
    expectedActiveGenerationId: idSchema.nullable(),
    nextGenerationId: idSchema,
    previous: authoritySchema.nullable(),
    next: authoritySchema,
    participantPlan: z.array(guiCutoverParticipantPlanEntrySchema).min(2).max(GUI_CUTOVER_PARTICIPANT_IDS.length),
    participantPlanDigest: digestSchema,
    appParticipantEvidence: z.array(participantEvidenceSchema).max(GUI_CUTOVER_PARTICIPANT_IDS.length),
    preferenceAdoption: preferenceAdoptionSchema.nullable(),
    phase: z.enum([
      "prepared",
      "staging",
      "cohort-frozen",
      "participants-ready",
      "admission-closing",
      "active",
      "draining",
      "retired",
      "aborted",
    ]),
    revision: z.number().int().nonnegative(),
    readyDeadlineAt: z.number().int().positive(),
    drainDeadlineAt: z.number().int().positive(),
  })
  .strict()
  .superRefine((intent, context) => {
    if (intent.expectedActiveGenerationId === null && intent.previous !== null) {
      context.addIssue({
        code: "custom",
        path: ["previous"],
        message: "previous GUI authority requires an expected active App generation",
      });
    }
    if (
      intent.previous &&
      intent.previous.generationId !== intent.expectedActiveGenerationId
    ) {
      context.addIssue({
        code: "custom",
        path: ["previous", "generationId"],
        message: "previous generation must equal the expected active generation",
      });
    }
    if (intent.nextGenerationId !== intent.next.generationId) {
      context.addIssue({
        code: "custom",
        path: ["nextGenerationId"],
        message: "next generation identity mismatch",
      });
    }
    const participantIds = intent.participantPlan.map((entry) => entry.participantId);
    if (new Set(participantIds).size !== participantIds.length) {
      context.addIssue({ code: "custom", path: ["participantPlan"], message: "participant plan ids must be unique" });
    }
    const appIds = new Set(intent.participantPlan
      .filter((entry) => entry.scope !== "surface")
      .map((entry) => entry.participantId));
    for (const [index, evidence] of intent.appParticipantEvidence.entries()) {
      if (!appIds.has(evidence.participantId)) {
        context.addIssue({ code: "custom", path: ["appParticipantEvidence", index], message: "evidence is not owned by an app-scoped participant" });
      }
    }
  });

export const appGuiSurfaceTransitionCohortSchema: z.ZodType<AppGuiSurfaceTransitionCohort> = z
  .object({
    cutoverId: idSchema,
    revision: z.number().int().nonnegative(),
    admission: z.enum(["collecting", "frozen", "closed"]),
    frozenRevision: z.number().int().nonnegative().nullable(),
    members: z.array(
      z.object({
        logicalSurfaceId: idSchema,
        mode: z.enum(["chat-tab", "studio"]),
        previousRuntimeSurfaceId: idSchema.nullable(),
        previousLeaseId: idSchema.nullable(),
        stagedRuntimeSurfaceId: idSchema,
        stagingLeaseId: idSchema.nullable(),
        readyEvidenceDigest: digestSchema.nullable(),
        state: z.enum(["staging", "ready", "closed", "swapped"]),
      }).strict()
    ).max(64),
  })
  .strict()
  .superRefine((cohort, context) => {
    if ((cohort.admission === "frozen") !== (cohort.frozenRevision !== null)) {
      context.addIssue({
        code: "custom",
        path: ["frozenRevision"],
        message: "only a frozen cohort owns a frozen revision",
      });
    }
    const logical = new Set<string>();
    const runtime = new Set<string>();
    cohort.members.forEach((member, index) => {
      if (logical.has(member.logicalSurfaceId)) {
        context.addIssue({ code: "custom", path: ["members", index], message: "duplicate logical surface" });
      }
      if (runtime.has(member.stagedRuntimeSurfaceId)) {
        context.addIssue({ code: "custom", path: ["members", index], message: "duplicate staged runtime surface" });
      }
      logical.add(member.logicalSurfaceId);
      runtime.add(member.stagedRuntimeSurfaceId);
    });
  });
