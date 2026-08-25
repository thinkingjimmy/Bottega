/**
 * [INPUT]: Depends on zod, shared Project binding, DurableJson and stable Project id
 * [OUTPUT]: Provides Project workspace rebind durable single-activated retain/new capsule, phase/checkpoint, restore listing and plug-in
 * [POS]: The project module is a re-binding saga bookletJust keep intent/checkpoint, not write Project/Policy/Delivery business facts
 */

import { join } from "node:path";
import { z } from "zod";
import {
  PROJECT_ID_PATTERN,
  type ProjectWorkspaceBinding,
} from "../../../shared/projects-ipc";
import { DurableJson } from "../persistence/durable-json";

const id = z.string().min(1).max(256);
const projectId = z.string().regex(PROJECT_ID_PATTERN);
const capabilityId = z.string().regex(/^[A-Za-z0-9_-]{10,64}$/);
const bindingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("external"), capabilityId }).strict(),
  z.object({ kind: z.literal("app"), appId: z.string().regex(/^[a-z0-9]{10}$/) }).strict(),
]);

const capsuleSchema = z.object({
  operationId: id,
  projectId,
  sourceBinding: bindingSchema,
  sourceDir: z.string(),
  sourceMembershipRevision: z.number().int().nonnegative(),
  expectedOldMemorySpaceId: z.string().min(1).nullable(),
  expectedSpaceGenerationRevision: z.number().int().nonnegative().nullable(),
  targetBinding: z.object({ kind: z.literal("external"), capabilityId }).strict(),
  targetDir: z.string().min(1),
  mode: z.enum(["retain", "new"]),
  phase: z.enum(["prepared", "memory-applied", "needs-reconcile"]),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

const stateSchema = z.object({
  version: z.literal(2),
  capsules: z.record(projectId, capsuleSchema),
}).strict();

export type ProjectRebindCapsule = z.infer<typeof capsuleSchema>;
export type ProjectRebindExpectation = Pick<
  ProjectRebindCapsule,
  "expectedOldMemorySpaceId" | "expectedSpaceGenerationRevision"
>;

export class ProjectRebindJournal {
  private readonly store: DurableJson<z.infer<typeof stateSchema>>;

  constructor(userData: string, private readonly now: () => number = Date.now) {
    this.store = new DurableJson(
      join(userData, "project-rebinds.json"),
      stateSchema,
      () => ({ version: 2, capsules: {} })
    );
  }

  initialize() {
    return this.store.initialize();
  }

  list() {
    return Object.values(this.store.snapshot().capsules).map((capsule) =>
      structuredClone(capsule)
    );
  }

  get(projectIdValue: string) {
    const capsule = this.store.snapshot().capsules[projectIdValue];
    return capsule ? structuredClone(capsule) : null;
  }

  begin(input: {
    operationId: string;
    projectId: string;
    sourceBinding: ProjectWorkspaceBinding;
    sourceDir: string;
    sourceMembershipRevision: number;
    expectedOldMemorySpaceId: string | null;
    expectedSpaceGenerationRevision: number | null;
    targetBinding: Extract<ProjectWorkspaceBinding, { kind: "external" }>;
    targetDir: string;
    mode: "retain" | "new";
  }) {
    return this.store.mutate((state) => {
      if (
        (input.expectedOldMemorySpaceId === null) !==
        (input.expectedSpaceGenerationRevision === null)
      ) {
        throw new Error("Memory rebind expectation 必须同时存在或同时为空");
      }
      const existing = state.capsules[input.projectId];
      if (existing) {
        if (existing.operationId !== input.operationId) {
          throw new Error("Project 已有 workspace 改绑待完成");
        }
        return existing;
      }
      const now = this.now();
      const capsule = capsuleSchema.parse({
        ...input,
        phase: "prepared",
        createdAt: now,
        updatedAt: now,
      });
      state.capsules[input.projectId] = capsule;
      return capsule;
    });
  }

  mark(operationId: string, phase: "memory-applied" | "needs-reconcile") {
    return this.store.mutate((state) => {
      const capsule = this.byOperation(state, operationId);
      if (capsule.phase === "memory-applied" && phase === "needs-reconcile") {
        capsule.phase = phase;
      } else if (capsule.phase === "prepared") {
        capsule.phase = phase;
      }
      capsule.updatedAt = this.now();
      return capsule;
    });
  }

  finish(operationId: string) {
    return this.store.mutate((state) => {
      const capsule = this.byOperation(state, operationId);
      delete state.capsules[capsule.projectId];
      return capsule;
    });
  }

  abortBeforeEffect(operationId: string) {
    return this.store.mutate((state) => {
      const capsule = this.byOperation(state, operationId);
      if (capsule.phase !== "prepared") {
        throw new Error("Memory effect 已应用，禁止清除 rebind capsule");
      }
      delete state.capsules[capsule.projectId];
      return capsule;
    });
  }

  closeAndFlush() {
    return this.store.closeAndFlush();
  }

  private byOperation(
    state: z.infer<typeof stateSchema>,
    operationId: string
  ) {
    const capsule = Object.values(state.capsules).find(
      (item) => item.operationId === operationId
    );
    if (!capsule) throw new Error("Project rebind capsule 不存在");
    return capsule;
  }
}
