/**
 * [INPUT]: Closed Artifact fences, Chat incarnation and shared workspace request/event contracts.
 * [OUTPUT]: ID-scoped file/import/preview/workspace methods, lifecycle subscriptions and fixed storage budgets.
 * [POS]: apps/desktop/shared/ipc/apps; Desktop artifact boundary; only main resolves stored snapshot paths.
 */
import { z } from "zod";
export { artifactFenceSchema, type ArtifactFence, type ArtifactKind } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
export const artifactRefSchema = z.object({ chatId: z.string().min(1).max(128), incarnationId: z.string().min(1).max(128),
  artifactId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).strict();
export type ArtifactRef = z.infer<typeof artifactRefSchema>;
export const ARTIFACT_BUDGET = { fragment: 1_048_576, document: 16_777_216, chat: 536_870_912, global: 4_294_967_296 } as const;
export { ARTIFACT_IPC } from "../../ipc-channels/apps";
export type ArtifactLease = { id: string; url: string; origin: string; expiresAt: number; sandbox: "allow-scripts" | "allow-scripts allow-same-origin" };
export type ArtifactAction = "quick-look" | "reveal" | "open" | "save";
export type ArtifactWorkbook = { exists: boolean; sheets: { name: string; imported: boolean; hasId: boolean }[] };
export interface ArtifactBridge {
  workspace(input: import("@ai-chat/cloud-protocol/artifacts/design/model").WorkspaceCommand): Promise<unknown>;
  onWorkspaceEvent(listener: (event: { type: "before-disable" | "changed"; nonce?: string; generation: string; enabled?: boolean; scope?: string }) => void): () => void;
  preview(ref: ArtifactRef, action: "preview-status" | "preview-start" | "preview-stop" | "preview-issue-code" | "preview-keep-running"): Promise<import("@ai-chat/cloud-protocol/resources/preview").PreviewView>;
  lease(ref: ArtifactRef): Promise<ArtifactLease>;
  release(id: string): Promise<void>;
  action(ref: ArtifactRef, action: ArtifactAction): Promise<void>;
  workbook(ref: ArtifactRef): Promise<ArtifactWorkbook>;
  importBase(ref: ArtifactRef, sheet: string, confirmed: boolean): Promise<{ baseId: string }>;
}
