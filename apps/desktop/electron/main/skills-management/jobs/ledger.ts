/**
 * [INPUT]: Depends on DurableJson upgrades, Node crypto/path, zod, and shared Library-first job/report DTOs
 * [OUTPUT]: Provides jobs schema v2 with acquisition, enablement, deletion, restart checkpoints, inverse enablement facts, reports, and old activation-ledger abandonment
 * [POS]: Durable Skills mutation receipt; projection/native actions are unrepresentable in this generation
 */

import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type {
  ManagedSkillImportOutcome,
  ManagedSkillJobProgress,
  ManagedSkillReason,
  ManagedSkillTerminalReport,
} from "../../../../shared/unified-skills-ipc";
import {
  DurableJson,
  initializeDurableJsonOrQuarantine,
} from "../../persistence/durable-json";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const reasonSchema = z
  .object({
    code: z.string().min(1),
    detail: z.string().min(1).optional(),
  })
  .strict();
const stepSchema = z
  .object({
    stepId: z.string().min(1),
    action: z.enum([
      "import",
      "set-library-enabled",
      "set-extension-enabled",
      "delete-library",
    ]),
    status: z.enum(["pending", "running", "completed", "failed"]),
    idempotencyKey: z.string().min(1),
    skillRef: z.string().min(1),
    libraryId: z.string().min(1).nullable(),
    sourceIdentity: z.string().min(1).nullable(),
    sourceKind: z.enum(["local-folder", "adopted"]).nullable(),
    agent: z.enum(["codex", "claude", "kimi", "opencode"]).nullable(),
    sourcePath: z.string().min(1).nullable(),
    name: z.string().min(1),
    displayName: z.string().min(1),
    digest: digestSchema.nullable(),
    enabled: z.boolean().nullable(),
    previousEnabled: z.boolean().nullable(),
    componentInstanceIdentity: z.string().min(1).nullable(),
    importOutcome: z.enum(["created", "updated", "unchanged"]).nullable(),
    failure: reasonSchema.nullable(),
  })
  .strict();
const reportSchema = z
  .object({
    batchId: z.string().min(1),
    finishedAt: z.number().int().nonnegative(),
    acquisition: z
      .object({
        created: z.number().int().nonnegative(),
        updated: z.number().int().nonnegative(),
        unchanged: z.number().int().nonnegative(),
      })
      .strict(),
    enablement: z
      .object({
        enabled: z.number().int().nonnegative(),
        disabled: z.number().int().nonnegative(),
      })
      .strict(),
    deleted: z.number().int().nonnegative(),
    issues: z.array(
      z
        .object({ skillName: z.string().min(1), reason: reasonSchema })
        .strict()
    ),
    affectedSkillRefs: z.array(z.string().min(1)),
    undoToken: z.string().min(1).optional(),
  })
  .strict();
const jobSchema = z
  .object({
    batchId: z.string().min(1),
    planId: z.string().min(1),
    planDigest: digestSchema,
    authorityTokenHash: digestSchema,
    authorizedAt: z.number().int().nonnegative(),
    status: z.enum([
      "authorized",
      "running",
      "completed",
      "completed-with-failures",
      "failed",
      "undo-running",
      "undone",
      "abandoned",
    ]),
    cursor: z.number().int().nonnegative(),
    steps: z.array(stepSchema),
    report: reportSchema.nullable(),
    undoTokenHash: digestSchema.nullable(),
  })
  .strict();
const storeSchema = z
  .object({
    schemaVersion: z.literal(2),
    jobs: z.array(jobSchema),
    abandonedJobs: z.number().int().nonnegative(),
  })
  .strict();

type Store = z.infer<typeof storeSchema>;
type StoredJob = z.infer<typeof jobSchema>;
export type SkillsJobStep = z.infer<typeof stepSchema>;
export type SkillsJob = StoredJob;

export type SkillsJobLedgerFaults = Readonly<{
  afterAuthorizedReceipt?: (batchId: string) => void | Promise<void>;
  beforeTerminalReport?: (batchId: string) => void | Promise<void>;
}>;

export class SkillsJobLedger {
  private readonly file: DurableJson<Store>;

  constructor(
    userData: string,
    private readonly faults: SkillsJobLedgerFaults = {}
  ) {
    this.file = new DurableJson(
      join(userData, "unified-skills", "jobs.json"),
      storeSchema,
      () => ({ schemaVersion: 2, jobs: [], abandonedJobs: 0 })
    );
  }

  initialize() {
    return initializeDurableJsonOrQuarantine(this.file, upgradeJobs);
  }

  snapshot() {
    return this.file.snapshot();
  }

  async authorizePlan(
    input: Readonly<{
      planId: string;
      planDigest: `sha256:${string}`;
      authorityToken: string;
      steps: readonly SkillsJobStep[];
    }>,
    now = Date.now()
  ) {
    const replay = this.file
      .snapshot()
      .jobs.find((job) => job.planId === input.planId);
    if (replay) {
      if (replay.planDigest !== input.planDigest) {
        throw conflict("plan digest changed");
      }
      return replay;
    }
    const job = await this.file.mutate((state) => {
      trimTerminalJobs(state);
      const stored: StoredJob = {
        batchId: randomUUID(),
        planId: input.planId,
        planDigest: input.planDigest,
        authorityTokenHash: hash(input.authorityToken),
        authorizedAt: now,
        status: "authorized",
        cursor: 0,
        steps: input.steps.map((step) => stepSchema.parse(step)),
        report: null,
        undoTokenHash: null,
      };
      state.jobs.push(stored);
      return stored;
    });
    await this.faults.afterAuthorizedReceipt?.(job.batchId);
    return job;
  }

  resumableJobs() {
    return this.file.snapshot().jobs.filter((job) =>
      ["authorized", "running"].includes(job.status)
    );
  }

  job(batchId: string) {
    return (
      this.file.snapshot().jobs.find((item) => item.batchId === batchId) ?? null
    );
  }

  latest(): ManagedSkillJobProgress | null {
    const job = this.file.snapshot().jobs.at(-1);
    return job ? publicJob(job) : null;
  }

  progress(batchId: string): ManagedSkillJobProgress | null {
    const job = this.job(batchId);
    return job ? publicJob(job) : null;
  }

  start(batchId: string) {
    return this.file.mutate((state) => {
      const job = requireJob(state, batchId);
      if (job.status === "authorized") job.status = "running";
      return job;
    });
  }

  beginStep(batchId: string, stepId: string) {
    return this.file.mutate((state) => {
      const step = requireStep(requireJob(state, batchId), stepId);
      if (step.status === "pending") step.status = "running";
      return step;
    });
  }

  checkpoint(
    batchId: string,
    stepId: string,
    patch: Readonly<{
      libraryId?: string;
      previousEnabled?: boolean;
      importOutcome?: ManagedSkillImportOutcome;
    }> = {}
  ) {
    return this.file.mutate((state) => {
      const job = requireJob(state, batchId);
      const step = requireStep(job, stepId);
      step.status = "completed";
      if (patch.libraryId !== undefined) step.libraryId = patch.libraryId;
      if (patch.previousEnabled !== undefined) {
        step.previousEnabled = patch.previousEnabled;
      }
      if (patch.importOutcome !== undefined) step.importOutcome = patch.importOutcome;
      advance(job);
      return step;
    });
  }

  failStep(batchId: string, stepId: string, reason: ManagedSkillReason) {
    return this.file.mutate((state) => {
      const job = requireJob(state, batchId);
      const step = requireStep(job, stepId);
      step.status = "failed";
      step.failure = reasonSchema.parse(reason);
      advance(job);
      return step;
    });
  }

  async finish(batchId: string, report: ManagedSkillTerminalReport) {
    await this.faults.beforeTerminalReport?.(batchId);
    return this.file.mutate((state) => {
      const job = requireJob(state, batchId);
      job.report = reportSchema.parse(report);
      job.undoTokenHash = report.undoToken ? hash(report.undoToken) : null;
      job.status = job.steps.some((step) => step.status === "failed")
        ? "completed-with-failures"
        : "completed";
      return job;
    });
  }

  jobForUndo(undoToken: string) {
    const tokenHash = hash(undoToken);
    return (
      this.file.snapshot().jobs.find(
        (job) =>
          job.undoTokenHash === tokenHash &&
          ["completed", "completed-with-failures"].includes(job.status)
      ) ?? null
    );
  }

  startUndo(batchId: string) {
    return this.file.mutate((state) => {
      const job = requireJob(state, batchId);
      if (["completed", "completed-with-failures"].includes(job.status)) {
        job.status = "undo-running";
      }
      return job;
    });
  }

  markUndone(batchId: string) {
    return this.file.mutate((state) => {
      const job = requireJob(state, batchId);
      job.status = "undone";
      job.undoTokenHash = null;
      return job;
    });
  }

  closeAndFlush() {
    return this.file.closeAndFlush();
  }
}

export function createSkillsJobStep(
  input: Omit<
    SkillsJobStep,
    | "stepId"
    | "status"
    | "libraryId"
    | "sourceIdentity"
    | "sourceKind"
    | "sourcePath"
    | "agent"
    | "digest"
    | "enabled"
    | "previousEnabled"
    | "componentInstanceIdentity"
    | "importOutcome"
    | "failure"
  > &
    Partial<
      Pick<
        SkillsJobStep,
        | "stepId"
        | "libraryId"
        | "sourceIdentity"
        | "sourceKind"
        | "sourcePath"
        | "agent"
        | "digest"
        | "enabled"
        | "previousEnabled"
        | "componentInstanceIdentity"
      >
    >
): SkillsJobStep {
  return stepSchema.parse({
    stepId: input.stepId ?? randomUUID(),
    status: "pending",
    libraryId: null,
    sourceIdentity: null,
    sourceKind: null,
    sourcePath: null,
    agent: null,
    digest: null,
    enabled: null,
    previousEnabled: null,
    componentInstanceIdentity: null,
    importOutcome: null,
    failure: null,
    ...input,
  });
}

export function blankTerminalReport(
  batchId: string
): ManagedSkillTerminalReport {
  return {
    batchId,
    finishedAt: Date.now(),
    acquisition: { created: 0, updated: 0, unchanged: 0 },
    enablement: { enabled: 0, disabled: 0 },
    deleted: 0,
    issues: [],
    affectedSkillRefs: [],
  };
}

export function importIdempotencyKey(
  sourceIdentity: string,
  name: string,
  digest: string
) {
  return `import:${hash(`${sourceIdentity}\0${name}\0${digest}`)}`;
}

function upgradeJobs(raw: unknown): Store | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as {
    schemaVersion?: unknown;
    jobs?: unknown;
    abandonedJobs?: unknown;
  };
  if (value.schemaVersion === 2) {
    return {
      schemaVersion: 2,
      jobs: Array.isArray(value.jobs) ? (value.jobs as Store["jobs"]) : [],
      abandonedJobs:
        typeof value.abandonedJobs === "number" ? value.abandonedJobs : 0,
    };
  }
  if (value.schemaVersion !== 1 || !Array.isArray(value.jobs)) return undefined;
  const abandoned = value.jobs.filter((job) => {
    const status =
      job && typeof job === "object"
        ? (job as { status?: unknown }).status
        : null;
    return ![
      "completed",
      "completed-with-failures",
      "failed",
      "undone",
    ].includes(String(status));
  }).length;
  return { schemaVersion: 2, jobs: [], abandonedJobs: abandoned };
}

function publicJob(job: StoredJob): ManagedSkillJobProgress {
  return {
    batchId: job.batchId,
    status: job.status,
    processed: job.steps.filter((step) =>
      ["completed", "failed"].includes(step.status)
    ).length,
    total: job.steps.length,
    report: job.report as ManagedSkillTerminalReport | null,
  };
}

function trimTerminalJobs(state: Store) {
  const terminal = state.jobs.filter((job) =>
    [
      "completed",
      "completed-with-failures",
      "failed",
      "undone",
      "abandoned",
    ].includes(job.status)
  );
  const excess = terminal.length - 15;
  if (excess <= 0) return;
  const drop = new Set(
    terminal.slice(0, excess).map((job) => job.batchId)
  );
  state.jobs = state.jobs.filter((job) => !drop.has(job.batchId));
}

function advance(job: StoredJob) {
  while (
    ["completed", "failed"].includes(job.steps[job.cursor]?.status ?? "")
  ) {
    job.cursor += 1;
  }
}

function requireJob(state: Store, batchId: string) {
  const job = state.jobs.find((item) => item.batchId === batchId);
  if (!job) throw new Error("Skills job does not exist");
  return job;
}

function requireStep(job: StoredJob, stepId: string) {
  const step = job.steps.find((item) => item.stepId === stepId);
  if (!step) throw new Error("Skills job step does not exist");
  return step;
}

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}
