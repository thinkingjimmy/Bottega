/**
 * [INPUT]: Depends on zod plus shared Project, App grant, and workspace identity contracts
 * [OUTPUT]: Provides strict projects.json v8 plus frozen v4/v5/v6/v7 readers, Project App placement/grant invariants, hidden Base custody, lifecycle cleanup, and monotonic generations
 * [POS]: Project persistence schema boundary; ProjectStore owns mutations while this module owns validation and deterministic legacy migration
 */

import { isAbsolute } from "node:path";
import { z } from "zod";
import {
  PROJECT_ID_PATTERN,
  workspaceCapabilityId,
  type Project,
} from "../../../../shared/projects-ipc";

export const PROJECT_STORE_SCHEMA_VERSION = 8;
export const projectSortModeSchema = z.enum(["last-updated", "manual"]);

const projectIdentityFields = {
  id: z.string().regex(PROJECT_ID_PATTERN),
  name: z.string().trim().min(1).max(100),
  dir: z.union([
    z.literal(""),
    z.string().min(1).refine(isAbsolute, "Project dir 必须是绝对路径"),
  ]),
  sortIndex: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
};

export const projectAppearanceSchema = z
  .object({ color: z.string().max(32), icon: z.string().max(64) })
  .strict();

const appCapabilityGrantSchema = z
  .object({
    appId: z.string().regex(/^[a-z0-9]{10}$/),
    data: z
      .object({ kind: z.literal("base"), level: z.enum(["read", "row-write"]) })
      .strict()
      .optional(),
    agentDelegation: z
      .object({ fileRead: z.boolean(), useData: z.boolean() })
      .strict(),
    grantedAt: z.number().int().nonnegative(),
  })
  .strict();

const appDisabledGrantSchema = z
  .object({
    appId: z.string().regex(/^[a-z0-9]{10}$/),
    state: z.literal("disabled"),
    disabledAt: z.number().int().nonnegative(),
  })
  .strict();

const capabilityIdSchema = z.string().regex(/^[A-Za-z0-9_-]{10,64}$/);
const workspaceBindingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({ kind: z.literal("external"), capabilityId: capabilityIdSchema })
    .strict(),
  z
    .object({
      kind: z.literal("app"),
      appId: z.string().regex(/^[a-z0-9]{10}$/),
    })
    .strict(),
]);

const grantsSchema = z.array(
  z.union([appCapabilityGrantSchema, appDisabledGrantSchema])
);

const projectAppPlacementSchema = z
  .object({
    appId: z.string().regex(/^[a-z0-9]{10}$/),
    pinnedAt: z.number().int().nonnegative(),
  })
  .strict();

const projectAppPlacementsSchema = z
  .array(projectAppPlacementSchema)
  .max(100)
  .superRefine((placements, context) => {
    const ids = new Set<string>();
    for (const [index, placement] of placements.entries()) {
      if (ids.has(placement.appId)) {
        context.addIssue({
          code: "custom",
          path: [index, "appId"],
          message: "同一 Project 内 App placement 必须唯一",
        });
      }
      ids.add(placement.appId);
    }
  });

const storedProjectV4Schema = z
  .object({
    ...projectIdentityFields,
    appearance: projectAppearanceSchema.optional(),
    workspaceBinding: workspaceBindingSchema,
    grants: grantsSchema,
    grantRevision: z.number().int().nonnegative(),
    membershipRevision: z.number().int().nonnegative(),
    archivedAt: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine(assertWorkspaceProjection);

const projectResourceAdmissionSchema = z
  .object({
    kind: z.literal("extension-install"),
    operationId: z.string().min(1),
    installIdentity: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    projectLifecycleRevision: z.number().int().positive(),
  })
  .strict();

const projectRemovalOperationSchema = z.enum([
  "delete-project-data",
  "detach-local-project",
  "delete-app-project",
  "delete-base-custody",
  "archive-purge",
  "rollback-app-project",
  "convert-compensation",
]);

export const projectDeletionCheckpointSchema = z
  .object({
    projectLifecycleRevision: z.number().int().positive(),
    operation: projectRemovalOperationSchema,
    operationIntentId: z.string().min(1).nullable(),
    planVersion: z.literal(1),
    requiredParticipants: z.array(z.string().min(1)).min(1).max(64),
    phase: z.enum(["closing-admission", "cleaning-resources", "ready-to-remove"]),
    completedParticipants: z.array(z.string().min(1)).max(64),
    frozenResourceAdmissions: z.array(projectResourceAdmissionSchema).max(64),
    blocked: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((checkpoint, context) => {
    const required = new Set(checkpoint.requiredParticipants);
    if (
      required.size !== checkpoint.requiredParticipants.length ||
      !required.has("project-runtime")
    ) {
      context.addIssue({
        code: "custom",
        path: ["requiredParticipants"],
        message: "Project cleanup plan 必须唯一且包含 runtime participant",
      });
    }
    if (
      checkpoint.completedParticipants.some((id) => !required.has(id))
    ) {
      context.addIssue({
        code: "custom",
        path: ["completedParticipants"],
        message: "Project cleanup completion 不属于冻结 plan",
      });
    }
    if (
      new Set(checkpoint.completedParticipants).size !==
      checkpoint.completedParticipants.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["completedParticipants"],
        message: "Project cleanup completion 不得重复",
      });
    }
    if (
      checkpoint.phase === "closing-admission" &&
      checkpoint.completedParticipants.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["completedParticipants"],
        message: "closing-admission 尚不能声明 participant 完成",
      });
    }
    if (
      checkpoint.phase === "ready-to-remove" &&
      (checkpoint.blocked !== null ||
        checkpoint.completedParticipants.length !== required.size ||
        checkpoint.completedParticipants.some((id) => !required.has(id)))
    ) {
      context.addIssue({
        code: "custom",
        path: ["phase"],
        message: "ready-to-remove 必须精确完成冻结 plan 且没有 blocker",
      });
    }
  });

const projectDeletionReceiptSchema = z
  .object({
    projectId: z.string().regex(PROJECT_ID_PATTERN),
    projectLifecycleRevision: z.number().int().positive(),
    operation: projectRemovalOperationSchema,
    operationIntentId: z.string().min(1).nullable(),
    completedAt: z.number().int().nonnegative(),
  })
  .strict();

const workspaceCapabilitiesSchema = z.record(
  capabilityIdSchema,
  z.string().min(1).refine(isAbsolute, "Workspace capability must be absolute")
);

const storedProjectV5Schema = z
  .object({
    ...projectIdentityFields,
    appearance: projectAppearanceSchema.optional(),
    workspaceBinding: workspaceBindingSchema,
    grants: grantsSchema,
    grantRevision: z.number().int().nonnegative(),
    membershipRevision: z.number().int().nonnegative(),
    projectLifecycleRevision: z.number().int().positive(),
    deletionCheckpoint: projectDeletionCheckpointSchema.optional(),
    resourceAdmissions: z.array(projectResourceAdmissionSchema).max(64).default([]),
    archivedAt: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((project, context) =>
    assertStoredProject(project, context, false)
  );

const storedProjectV6Schema = z
  .object({
    ...projectIdentityFields,
    appearance: projectAppearanceSchema.optional(),
    workspaceBinding: workspaceBindingSchema,
    role: z.enum(["workspace", "base-custody"]).default("workspace"),
    nameSource: z.enum(["app", "user"]).default("user"),
    grants: grantsSchema,
    grantRevision: z.number().int().nonnegative(),
    membershipRevision: z.number().int().nonnegative(),
    projectLifecycleRevision: z.number().int().positive(),
    deletionCheckpoint: projectDeletionCheckpointSchema.optional(),
    resourceAdmissions: z.array(projectResourceAdmissionSchema).max(64).default([]),
    archivedAt: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((project, context) =>
    assertStoredProject(project, context, false)
  );

const storedProjectV7Schema = z
  .object({
    ...projectIdentityFields,
    appearance: projectAppearanceSchema.optional(),
    workspaceBinding: workspaceBindingSchema,
    role: z.enum(["workspace", "base-custody"]).default("workspace"),
    nameSource: z.enum(["app", "user"]).default("user"),
    appPlacements: projectAppPlacementsSchema,
    grants: grantsSchema,
    grantRevision: z.number().int().nonnegative(),
    membershipRevision: z.number().int().nonnegative(),
    projectLifecycleRevision: z.number().int().positive(),
    deletionCheckpoint: projectDeletionCheckpointSchema.optional(),
    resourceAdmissions: z.array(projectResourceAdmissionSchema).max(64).default([]),
    archivedAt: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((project, context) =>
    assertStoredProject(project, context, true, false)
  );

export const storedProjectSchema = z
  .object({
    ...projectIdentityFields,
    appearance: projectAppearanceSchema.optional(),
    workspaceBinding: workspaceBindingSchema,
    role: z.enum(["workspace", "base-custody"]).default("workspace"),
    nameSource: z.enum(["app", "user"]).default("user"),
    appPlacements: projectAppPlacementsSchema,
    grants: grantsSchema,
    grantRevision: z.number().int().nonnegative(),
    membershipRevision: z.number().int().nonnegative(),
    projectLifecycleRevision: z.number().int().positive(),
    deletionCheckpoint: projectDeletionCheckpointSchema.optional(),
    resourceAdmissions: z.array(projectResourceAdmissionSchema).max(64).default([]),
    archivedAt: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((project, context) =>
    assertStoredProject(project, context, true, true)
  );

export const projectFileSchema = z
  .object({
    schemaVersion: z.literal(PROJECT_STORE_SCHEMA_VERSION),
    commitGeneration: z.number().int().nonnegative(),
    lifecycleSequence: z.number().int().nonnegative(),
    sortMode: projectSortModeSchema.default("manual"),
    projects: z.array(storedProjectSchema),
    deletionReceipts: z.array(projectDeletionReceiptSchema).default([]),
    workspaceCapabilities: workspaceCapabilitiesSchema,
  })
  .strict()
  .superRefine((file, context) => {
    const keys = new Set<string>();
    for (const [index, receipt] of file.deletionReceipts.entries()) {
      const key = `${receipt.projectId}\0${receipt.operation}\0${receipt.operationIntentId ?? ""}`;
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["deletionReceipts", index],
          message: "Project deletion receipt identity 必须唯一",
        });
      }
      keys.add(key);
      if (file.projects.some((project) => project.id === receipt.projectId)) {
        context.addIssue({
          code: "custom",
          path: ["deletionReceipts", index, "projectId"],
          message: "已删除 receipt 不得与 live Project 共存",
        });
      }
    }
  });

export const projectFileV4Schema = z
  .object({
    schemaVersion: z.literal(4),
    sortMode: projectSortModeSchema.default("manual"),
    projects: z.array(storedProjectV4Schema),
    workspaceCapabilities: z.record(
      capabilityIdSchema,
      z.string().min(1).refine(isAbsolute, "Workspace capability 必须指向绝对路径")
    ),
  })
  .strict();

export const projectFileV5Schema = z
  .object({
    schemaVersion: z.literal(5),
    commitGeneration: z.number().int().nonnegative(),
    lifecycleSequence: z.number().int().nonnegative(),
    sortMode: projectSortModeSchema.default("manual"),
    projects: z.array(storedProjectV5Schema),
    deletionReceipts: z.array(projectDeletionReceiptSchema).default([]),
    workspaceCapabilities: workspaceCapabilitiesSchema,
  })
  .strict();

export const projectFileV6Schema = z
  .object({
    schemaVersion: z.literal(6),
    commitGeneration: z.number().int().nonnegative(),
    lifecycleSequence: z.number().int().nonnegative(),
    sortMode: projectSortModeSchema.default("manual"),
    projects: z.array(storedProjectV6Schema),
    deletionReceipts: z.array(projectDeletionReceiptSchema).default([]),
    workspaceCapabilities: workspaceCapabilitiesSchema,
  })
  .strict();

export const projectFileV7Schema = z
  .object({
    schemaVersion: z.literal(7),
    commitGeneration: z.number().int().nonnegative(),
    lifecycleSequence: z.number().int().nonnegative(),
    sortMode: projectSortModeSchema.default("manual"),
    projects: z.array(storedProjectV7Schema),
    deletionReceipts: z.array(projectDeletionReceiptSchema).default([]),
    workspaceCapabilities: workspaceCapabilitiesSchema,
  })
  .strict();

export type ProjectDeletionCheckpoint = z.infer<
  typeof projectDeletionCheckpointSchema
>;
export type ProjectRemovalOperation = ProjectDeletionCheckpoint["operation"];
export type ProjectResourceAdmission = z.infer<
  typeof projectResourceAdmissionSchema
>;
export type StoredProject = Omit<Project, "missing"> &
  z.infer<typeof storedProjectSchema>;
export type ProjectFile = z.infer<typeof projectFileSchema>;

function assertStoredProject(
  project: {
    workspaceBinding: { kind: string };
    dir: string;
    role?: "workspace" | "base-custody";
    grants: readonly unknown[];
    appPlacements?: readonly Readonly<{ appId: string }>[];
    resourceAdmissions: readonly ProjectResourceAdmission[];
    deletionCheckpoint?: ProjectDeletionCheckpoint;
    projectLifecycleRevision: number;
  },
  context: z.RefinementCtx,
  enforcePlacements: boolean,
  enforcePlacementGrants = false
) {
  assertWorkspaceProjection(project, context);
  if (
    project.deletionCheckpoint &&
    project.deletionCheckpoint.projectLifecycleRevision !==
      project.projectLifecycleRevision
  ) {
    context.addIssue({
      code: "custom",
      path: ["deletionCheckpoint", "projectLifecycleRevision"],
      message: "Project cleanup checkpoint 与 lifecycle revision 不一致",
    });
  }
  if (enforcePlacementGrants && project.appPlacements?.length) {
    const positiveGrantIds = new Set(
      (
        project.grants as readonly Readonly<{
          appId: string;
          state?: string;
        }>[]
      ).filter((grant) => grant.state !== "disabled")
        .map((grant) => grant.appId)
    );
    project.appPlacements.forEach((placement, index) => {
      if (positiveGrantIds.has(placement.appId)) return;
      context.addIssue({
        code: "custom",
        path: ["appPlacements", index, "appId"],
        message: "Sidebar placement 必须对应当前 Project 的正向 App grant",
      });
    });
  }
  if (
    project.role === "base-custody" &&
    (project.workspaceBinding.kind !== "none" ||
      project.dir !== "" ||
      project.grants.length > 0 ||
      project.resourceAdmissions.length > 0)
  ) {
    context.addIssue({
      code: "custom",
      path: ["role"],
      message: "base-custody 不得持有 workspace、grant 或 runtime admission",
    });
  }
  if (
    enforcePlacements &&
    project.appPlacements?.length &&
    (project.role === "base-custody" || project.workspaceBinding.kind === "app")
  ) {
    context.addIssue({
      code: "custom",
      path: ["appPlacements"],
      message: "App-bound 或 base-custody Project 不得持有 App placement",
    });
  }
  const invalidAdmission = project.deletionCheckpoint
    ? project.resourceAdmissions.some(
        (item) =>
          !project.deletionCheckpoint!.frozenResourceAdmissions.some(
            (frozen) =>
              frozen.operationId === item.operationId &&
              frozen.installIdentity === item.installIdentity &&
              frozen.projectLifecycleRevision === item.projectLifecycleRevision
          )
      )
    : project.resourceAdmissions.some(
        (item) =>
          item.projectLifecycleRevision !== project.projectLifecycleRevision
      );
  if (invalidAdmission) {
    context.addIssue({
      code: "custom",
      path: ["resourceAdmissions"],
      message: "Project resource admission 未绑定当前 lifecycle 或冻结删除清单",
    });
  }
  if (
    project.deletionCheckpoint &&
    new Set(
      project.deletionCheckpoint.frozenResourceAdmissions.map(
        (item) => item.operationId
      )
    ).size !== project.deletionCheckpoint.frozenResourceAdmissions.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["deletionCheckpoint", "frozenResourceAdmissions"],
      message: "Project deletion frozen admission 含重复 operation",
    });
  }
}

function assertWorkspaceProjection(
  project: { workspaceBinding: { kind: string }; dir: string },
  context: z.RefinementCtx
) {
  if (project.workspaceBinding.kind === "none" && project.dir !== "") {
    context.addIssue({
      code: "custom",
      path: ["dir"],
      message: "none binding 不保存目录",
    });
  }
  if (
    workspaceCapabilityId(
      project.workspaceBinding as Parameters<typeof workspaceCapabilityId>[0]
    ) &&
    project.dir === ""
  ) {
    context.addIssue({
      code: "custom",
      path: ["dir"],
      message: `${project.workspaceBinding.kind} binding 缺少目录投影`,
    });
  }
}
