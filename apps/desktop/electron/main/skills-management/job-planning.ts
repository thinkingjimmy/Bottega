/**
 * [INPUT]: Depends on path-private import authorities, Library sources/store, verified package inspection, jobs-v2 step constructors, and trusted prompt composition
 * [OUTPUT]: Provides import/existing intent planners, terminal-report projection, and enabled-Library prompt-byte estimation
 * [POS]: Pure planning/report helper for skills-management; service owns authority lifetime and execution, while this file converts frozen facts into receipts and summaries
 */

import { randomUUID } from "node:crypto";
import type {
  ManagedSkillIntentInput,
  ManagedSkillTerminalReport,
} from "../../../shared/unified-skills-ipc";
import { composeSkills } from "../agent/product-context";
import type { CandidateAuthority } from "./candidate-status";
import {
  blankTerminalReport,
  createSkillsJobStep,
  importIdempotencyKey,
  type SkillsJob,
  type SkillsJobStep,
} from "./jobs/ledger";
import type { ManagedSkillsLibraryStore } from "./library-store";
import { verifyInspectedSkill } from "./package";
import type { HeldImport } from "./orchestration/discovery-state";
import type { LibrarySource } from "./orchestration/library-sources";

export async function planImportIntent(
  intent: Extract<ManagedSkillIntentInput, { type: "import-and-enable" }>,
  imports: ReadonlyMap<string, HeldImport>,
  library: ManagedSkillsLibraryStore
): Promise<SkillsJobStep[]> {
  const held = imports.get(intent.previewId);
  if (!held || held.revision !== intent.revision) {
    throw conflict("import preview is stale");
  }
  const selected = [...new Set(intent.candidateRefs)].map((ref) =>
    held.authorities.get(ref)
  );
  if (!selected.length || selected.some((candidate) => !candidate)) {
    throw invalid("import selection is invalid");
  }
  const output: SkillsJobStep[] = [];
  for (const candidate of selected as CandidateAuthority[]) {
    if (!candidate.inspection.importable) {
      throw conflict(`skill-inspection:${candidate.inspection.reason.code}`);
    }
    const skill = candidate.inspection.skill.digest
      ? candidate.inspection.skill
      : await verifyInspectedSkill(candidate.inspection.skill);
    const existing = library.snapshot().entries.find(
      (entry) =>
        entry.tombstoneAt === null &&
        entry.provenance.sourceIdentity === candidate.sourceIdentity &&
        entry.name === skill.name
    );
    output.push(
      createSkillsJobStep({
        action: "import",
        idempotencyKey: importIdempotencyKey(
          candidate.sourceIdentity,
          skill.name,
          skill.digest!
        ),
        skillRef: `pending:${candidate.sourceIdentity}:${skill.name}`,
        libraryId: existing?.libraryId ?? null,
        sourceIdentity: candidate.sourceIdentity,
        sourceKind:
          candidate.agent === "local-folder" ? "local-folder" : "adopted",
        sourcePath: candidate.sourcePath,
        agent: candidate.agent === "local-folder" ? null : candidate.agent,
        name: skill.name,
        displayName: skill.displayName,
        digest: skill.digest!,
        previousEnabled: existing?.enabled ?? false,
      })
    );
  }
  return output;
}

export function planExistingIntent(
  intent: Exclude<ManagedSkillIntentInput, { type: "import-and-enable" }>,
  sources: readonly LibrarySource[]
): SkillsJobStep[] {
  const source = sources.find((item) => item.ref === intent.skillRef);
  if (!source) throw conflict("Skill source changed");
  if (intent.type === "delete") {
    if (!source.local) throw conflict("Extension Skill cannot be deleted here");
    return [
      createSkillsJobStep({
        action: "delete-library",
        idempotencyKey: `delete:${source.local.libraryId}`,
        skillRef: source.ref,
        libraryId: source.local.libraryId,
        name: source.name,
        displayName: source.displayName,
      }),
    ];
  }
  if (source.local) {
    return [
      createSkillsJobStep({
        action: "set-library-enabled",
        idempotencyKey: `library-enabled:${source.local.libraryId}:${intent.enabled}`,
        skillRef: source.ref,
        libraryId: source.local.libraryId,
        name: source.name,
        displayName: source.displayName,
        enabled: intent.enabled,
        previousEnabled: source.enabled,
      }),
    ];
  }
  if (!source.source.componentInstanceIdentity) {
    throw conflict("Extension component identity is missing");
  }
  if (intent.enabled && !source.source.active) {
    throw conflict("skills-intent:source-gone");
  }
  return [
    createSkillsJobStep({
      action: "set-extension-enabled",
      idempotencyKey: `extension-enabled:${source.source.componentInstanceIdentity}:${intent.enabled}`,
      skillRef: source.ref,
      componentInstanceIdentity: source.source.componentInstanceIdentity,
      name: source.name,
      displayName: source.displayName,
      enabled: intent.enabled,
      previousEnabled: source.enabled,
    }),
  ];
}

export function reportFor(job: SkillsJob): ManagedSkillTerminalReport {
  const report = blankTerminalReport(job.batchId);
  const acquisition = { ...report.acquisition };
  const enablement = { ...report.enablement };
  let deleted = 0;
  const issues: ManagedSkillTerminalReport["issues"][number][] = [];
  const affected = new Set<string>();
  let undoable = false;
  for (const step of job.steps) {
    if (step.status === "failed") {
      issues.push({
        skillName: step.name,
        reason: (step.failure ?? { code: "unknown" }) as ManagedSkillTerminalReport["issues"][number]["reason"],
      });
      continue;
    }
    if (step.status !== "completed") continue;
    if (step.action === "import" && step.importOutcome) {
      acquisition[step.importOutcome] += 1;
      if (step.libraryId) affected.add(`library:${step.libraryId}`);
      undoable = true;
    } else if (step.action.startsWith("set-")) {
      if (step.enabled) enablement.enabled += 1;
      else enablement.disabled += 1;
      affected.add(step.skillRef);
      undoable = true;
    } else if (step.action === "delete-library") {
      deleted += 1;
      affected.add(step.skillRef);
    }
  }
  return {
    ...report,
    acquisition,
    enablement,
    deleted,
    issues,
    affectedSkillRefs: [...affected],
    ...(undoable ? { undoToken: randomUUID() } : {}),
  };
}

export function estimateLibraryPromptBytes(sources: readonly LibrarySource[]) {
  const enabled = sources.filter((source) => source.enabled);
  if (!enabled.length) return 0;
  const summaries = enabled.map((source) => ({
    name: source.name,
    description: source.description,
    scope: "library" as const,
  }));
  return Buffer.byteLength(composeSkills(summaries, true), "utf8");
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}

function invalid(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}
