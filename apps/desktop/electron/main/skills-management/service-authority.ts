/**
 * [INPUT]: Depends on unified Skills preview and durable job-step contracts
 * [OUTPUT]: Provides held-plan shape and preview authority lifetime
 * [POS]: Narrow renderer-authority policy for UnifiedSkillsService; orchestration and persistence remain in service.ts
 */

import type { ManagedSkillPlanPreview } from "../../../shared/unified-skills-ipc";
import type { SkillsJobStep } from "./jobs/ledger";

export type HeldSkillsPlan = Readonly<{
  view: ManagedSkillPlanPreview;
  steps: readonly SkillsJobStep[];
}>;

export const SKILLS_AUTHORITY_TTL_MS = 5 * 60_000;
