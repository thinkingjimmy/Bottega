/**
 * [INPUT]: Depends on zod and shared SHA-256 digest primitives
 * [OUTPUT]: Provides the two-state App-global cutover intent (pre-active versus active), independent App CAS and previous-GUI authority identities, the frozen preference-adoption snapshot, the fixed participant id plan, and the 0..N surface cohort contract
 * [POS]: Shared app-gui cutover state machine; main persists the intent as a write-ahead record while the AppStore active CAS stays the single commit point, including first-GUI activation over an existing non-GUI App generation
 */

import { z } from "zod";
import type { Sha256Digest } from "../extensions-ipc";

const digestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/)
  .transform((value) => value as Sha256Digest);
const idSchema = z.string().trim().min(1).max(200);

/* 计划只剩「谁参与了这次切换」这一件事实。曾经每条 entry 还背着
   contractVersion / stagingOperations / sideEffectKinds 三份载荷，
   而请求期没有任何读者——它们只被算进一个从不比对的摘要里。 */
export const GUI_CUTOVER_PARTICIPANT_IDS = [
  "core-projection-v1",
  "core-bootstrap-v1",
  "base-query-v1",
  "base-revision-event-v1",
  "preferences-v1",
  "workspace-read-v1",
  "file-export-v1",
] as const;

export type GuiCutoverParticipantIdV1 =
  (typeof GUI_CUTOVER_PARTICIPANT_IDS)[number];

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
  participantPlan: readonly GuiCutoverParticipantIdV1[];
  preferenceAdoption: AppGuiPreferenceAdoptionSnapshot | null;
  /* 恢复只分得清两件事：Store CAS 之前（中止安全）与之后（只能前滚）。
     九个阶段名里另外七个从来没有读者，deadline 也一样——崩溃后重来的
     barrier 用的是新预算，不是上一条命剩下的。 */
  phase: "pending" | "active";
}>;

export type AppGuiSurfaceTransitionMember = Readonly<{
  logicalSurfaceId: string;
  mode: "chat-tab" | "studio";
  previousRuntimeSurfaceId: string | null;
  previousLeaseId: string | null;
  stagedRuntimeSurfaceId: string;
  stagingLeaseId: string | null;
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

export const appGuiGenerationIntentSchema: z.ZodType<AppGuiGenerationIntent> = z
  .object({
    cutoverId: idSchema,
    appId: idSchema,
    expectedActiveGenerationId: idSchema.nullable(),
    nextGenerationId: idSchema,
    previous: authoritySchema.nullable(),
    next: authoritySchema,
    participantPlan: z
      .array(z.enum(GUI_CUTOVER_PARTICIPANT_IDS))
      .min(2)
      .max(GUI_CUTOVER_PARTICIPANT_IDS.length),
    preferenceAdoption: preferenceAdoptionSchema.nullable(),
    phase: z.enum(["pending", "active"]),
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
    if (new Set(intent.participantPlan).size !== intent.participantPlan.length) {
      context.addIssue({
        code: "custom",
        path: ["participantPlan"],
        message: "participant plan ids must be unique",
      });
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
