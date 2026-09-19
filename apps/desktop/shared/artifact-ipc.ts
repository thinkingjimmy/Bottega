/**
 * [INPUT]: Shared artifact fence schemas and the closed Chat lifecycle identity.
 * [OUTPUT]: Path-free artifact lease, action and workbook import IPC contracts and storage budgets.
 * [POS]: Desktop artifact boundary; only main resolves stored snapshot paths.
 */
import { z } from "zod";
export { artifactFenceSchema, type ArtifactFence, type ArtifactKind } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
export const artifactRefSchema = z.object({ chatId: z.string().min(1).max(128), incarnationId: z.string().min(1).max(128),
  artifactId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).strict();
export type ArtifactRef = z.infer<typeof artifactRefSchema>;
export const ARTIFACT_BUDGET = { fragment: 1_048_576, document: 16_777_216, chat: 536_870_912, global: 4_294_967_296 } as const;
export const ARTIFACT_IPC = { lease: "artifact:lease", release: "artifact:release", action: "artifact:action", workbook: "artifact:workbook", importBase: "artifact:import-base" } as const;
export type ArtifactLease = { id: string; url: string; origin: string; expiresAt: number; sandbox: "allow-scripts" | "allow-scripts allow-same-origin" };
export type ArtifactAction = "quick-look" | "reveal" | "open" | "save";
export type ArtifactWorkbook = { exists: boolean; sheets: { name: string; imported: boolean; hasId: boolean }[] };
export interface ArtifactBridge {
  lease(ref: ArtifactRef): Promise<ArtifactLease>;
  release(id: string): Promise<void>;
  action(ref: ArtifactRef, action: ArtifactAction): Promise<void>;
  workbook(ref: ArtifactRef): Promise<ArtifactWorkbook>;
  importBase(ref: ArtifactRef, sheet: string, confirmed: boolean): Promise<{ baseId: string }>;
}
