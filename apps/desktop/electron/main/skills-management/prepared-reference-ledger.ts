/**
 * [INPUT]: Depends on DurableJson, strict Extension generation refs, and Registry atomic ref batches
 * [OUTPUT]: Provides intent-before-ref prepared Skill custody, ready assertions, release, and startup bidirectional reconciliation
 * [POS]: Durable owner between manual-turn preparation and live SkillsTurnCustody; only the skills-turn owner namespace is swept
 */

import { join } from "node:path";
import { z } from "zod";
import type {
  ExtensionPackageGenerationRef,
  Sha256Digest,
} from "../../../shared/extensions-ipc";
import { DurableJson } from "../persistence/durable-json";
import type { ExtensionRegistryStore } from "../extensions/registry-store";

const digest: z.ZodType<Sha256Digest> = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/)
  .transform((value) => value as Sha256Digest);
const refSchema: z.ZodType<ExtensionPackageGenerationRef> = z
  .object({
    packageGenerationId: z.string().min(1),
    recordDigest: digest,
  })
  .strict();
const entrySchema = z
  .object({
    ownerId: z.string().regex(/^skills-turn:[a-f0-9]{32}$/),
    refs: z.array(refSchema).min(1),
    phase: z.enum(["preparing", "ready", "release-pending"]),
    revision: z.number().int().nonnegative(),
  })
  .strict();
const fileSchema = z
  .object({ schemaVersion: z.literal(1), entries: z.array(entrySchema) })
  .strict()
  .superRefine((file, context) => {
    const owners = new Set<string>();
    for (const [index, entry] of file.entries.entries()) {
      const root = ["entries", index];
      if (owners.has(entry.ownerId)) {
        context.addIssue({
          code: "custom",
          path: [...root, "ownerId"],
          message: "prepared ref ownerId 必须唯一",
        });
      }
      owners.add(entry.ownerId);
      const refs = new Set(entry.refs.map(key));
      if (refs.size !== entry.refs.length) {
        context.addIssue({
          code: "custom",
          path: [...root, "refs"],
          message: "prepared generation refs 必须唯一",
        });
      }
      if (
        (entry.phase === "preparing" && entry.revision !== 0) ||
        (entry.phase !== "preparing" && entry.revision < 1)
      ) {
        context.addIssue({
          code: "custom",
          path: [...root, "revision"],
          message: "prepared ref phase/revision 非法",
        });
      }
    }
  });

export type PreparedReferenceLedgerFaults = Readonly<{
  afterIntent?: (ownerId: string) => void | Promise<void>;
  afterAcquire?: (ownerId: string) => void | Promise<void>;
}>;

export class PreparedSkillReferenceLedger {
  private readonly file: DurableJson<z.infer<typeof fileSchema>>;

  constructor(
    userData: string,
    private readonly registry: ExtensionRegistryStore,
    private readonly faults: PreparedReferenceLedgerFaults = {}
  ) {
    this.file = new DurableJson(
      join(userData, "agent-extensions", "prepared-skill-refs.json"),
      fileSchema,
      () => ({ schemaVersion: 1, entries: [] })
    );
  }

  initialize() {
    return this.file.initialize();
  }

  async prepare(
    ownerId: string,
    refs: readonly ExtensionPackageGenerationRef[]
  ) {
    const normalized = normalizeRefs(refs);
    await this.file.mutate((state) => {
      const existing = state.entries.find((entry) => entry.ownerId === ownerId);
      if (existing) {
        assertSameRefs(existing.refs, normalized);
        return;
      }
      state.entries.push({
        ownerId,
        refs: normalized,
        phase: "preparing",
        revision: 0,
      });
    });
    await this.faults.afterIntent?.(ownerId);
    await this.registry.acquireGenerationRefs(normalized, ownerId);
    await this.faults.afterAcquire?.(ownerId);
    await this.mark(ownerId, "ready");
  }

  async release(
    ownerId: string,
    refs: readonly ExtensionPackageGenerationRef[]
  ) {
    const entry = this.entry(ownerId);
    if (!entry) return;
    assertSameRefs(entry.refs, normalizeRefs(refs));
    await this.mark(ownerId, "release-pending");
    await this.registry.releaseGenerationRefs(entry.refs, ownerId);
    await this.file.mutate((state) => {
      state.entries = state.entries.filter((candidate) => candidate.ownerId !== ownerId);
    });
  }

  assertReady(
    ownerId: string,
    refs: readonly ExtensionPackageGenerationRef[]
  ) {
    const entry = this.entry(ownerId);
    if (!entry || entry.phase !== "ready") {
      throw conflict("Prepared Skill refs 尚未 ready");
    }
    assertSameRefs(entry.refs, normalizeRefs(refs));
  }

  async reconcile(liveOwnerIds: ReadonlySet<string>) {
    for (const entry of this.file.snapshot().entries) {
      if (liveOwnerIds.has(entry.ownerId)) {
        await this.registry.acquireGenerationRefs(entry.refs, entry.ownerId);
        await this.mark(entry.ownerId, "ready");
      } else {
        await this.release(entry.ownerId, entry.refs);
      }
    }
    const known = new Set(
      this.file
        .snapshot()
        .entries.map((entry) => entry.ownerId)
    );
    for (const held of this.registry.generationRefsHeldByOwnerPrefix(
      "skills-turn:"
    )) {
      for (const ownerId of held.ownerIds) {
        if (!known.has(ownerId)) {
          await this.registry.releaseGenerationRef(held.ref, ownerId);
        }
      }
    }
  }

  snapshot() {
    return this.file.snapshot();
  }

  private entry(ownerId: string) {
    return this.file.snapshot().entries.find((entry) => entry.ownerId === ownerId);
  }

  private mark(
    ownerId: string,
    phase: "ready" | "release-pending"
  ) {
    return this.file.mutate((state) => {
      const entry = state.entries.find((candidate) => candidate.ownerId === ownerId);
      if (!entry) throw new Error("Prepared Skill ref intent 不存在");
      if (entry.phase === phase) return;
      if (
        !(
          (entry.phase === "preparing" &&
            (phase === "ready" || phase === "release-pending")) ||
          (entry.phase === "ready" && phase === "release-pending") ||
          (entry.phase === "release-pending" && phase === "ready")
        )
      ) {
        throw conflict("Prepared Skill ref phase transition 非法");
      }
      entry.phase = phase;
      entry.revision += 1;
    });
  }
}

function normalizeRefs(refs: readonly ExtensionPackageGenerationRef[]) {
  return [...new Map(refs.map((ref) => [key(ref), structuredClone(ref)])).values()]
    .sort((left, right) => key(left).localeCompare(key(right)));
}

function assertSameRefs(
  left: readonly ExtensionPackageGenerationRef[],
  right: readonly ExtensionPackageGenerationRef[]
) {
  if (JSON.stringify(normalizeRefs(left)) !== JSON.stringify(normalizeRefs(right))) {
    throw conflict("Prepared Skill ref set 已漂移");
  }
}

function key(ref: ExtensionPackageGenerationRef) {
  return `${ref.packageGenerationId}\0${ref.recordDigest}`;
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}
