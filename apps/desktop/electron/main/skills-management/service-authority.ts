/**
 * [INPUT]: Depends on unified Skills preview and durable job-step contracts
 * [OUTPUT]: Provides held-plan shape, preview authority lifetime, and canonical 400/409 service errors
 * [POS]: Narrow renderer-authority policy for UnifiedSkillsService; orchestration and persistence remain in service.ts
 */

import type { ManagedSkillPlanPreview } from "../../../shared/unified-skills-ipc";
import type { SkillsJobStep } from "./jobs/ledger";

export type HeldSkillsPlan = Readonly<{
  view: ManagedSkillPlanPreview;
  steps: readonly SkillsJobStep[];
}>;

export const SKILLS_AUTHORITY_TTL_MS = 5 * 60_000;

export function skillsConflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}

export function invalidSkillsRequest(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}
