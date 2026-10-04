/**
 * [INPUT]: Depends on Zod.
 * [OUTPUT]: Provides stepReportSchema / StepReport: what an agent step reports through `submit_step_result` — the result text and optional artifact and evidence references (opaque host refs, never paths the Agent picks).
 * [POS]: Kept apart from run.ts so the built-in tool registry, which composes at startup, validates a report without loading the run model.
 */
import { z } from "zod";

const ref = z.string().min(1).max(512);
export const stepReportSchema = z.object({ result: z.string().min(1).max(65_536), artifactRef: ref.optional(), evidenceRefs: z.array(ref).max(32).optional() }).strict();
export type StepReport = z.infer<typeof stepReportSchema>;
