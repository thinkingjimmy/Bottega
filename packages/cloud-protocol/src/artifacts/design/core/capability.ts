/**
 * [INPUT]: Execution-computer state, authenticated connection and server time.
 * [OUTPUT]: Closed Artifact capability and freshness/availability decisions.
 * [POS]: Shared reader capability; no browser switch or implied execution permission.
 */
import { z } from "zod";
export const artifactCapabilitySchema = z.object({ enabled: z.boolean(), generation: z.string().min(1).max(128),
  protocolVersion: z.number().int().positive(), publishedAt: z.number().int().nonnegative() }).strict();
export type ArtifactCapability = z.infer<typeof artifactCapabilitySchema>;
export function artifactExecutionState(input: { online: boolean; protocolVersion: number; capability?: ArtifactCapability | null; now: number; requiredProtocol: number }) {
  if (input.protocolVersion !== input.requiredProtocol) return "upgrade" as const;
  if (!input.online) return "offline" as const;
  if (!input.capability || input.now - input.capability.publishedAt > 120_000 || input.capability.publishedAt > input.now + 10_000) return "checking" as const;
  return input.capability.enabled ? "ready" as const : "disabled" as const;
}
