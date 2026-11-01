/**
 * [INPUT]: Closed source identifiers, digests and exact mounted-view UUIDs.
 * [OUTPUT]: Shared bounded ArtifactWorkspaceEvent contract for lifecycle and completed native source changes.
 * [POS]: Path-free workspace event boundary shared by Desktop IPC and encrypted browser clients.
 */
import { z } from "zod";
import { designId, digestSchema } from "../reference/identifiers";
const generation = z.string().min(1).max(128);
export const artifactWorkspaceEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("before-disable"), nonce: z.string().uuid(), generation, scope: z.string().uuid() }).strict(),
  z.object({ type: z.literal("changed"), generation, enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("source-changed"), generation, scope: z.string().uuid(), documentId: designId,
    revision: z.number().int().positive(), snapshotRef: digestSchema }).strict(),
]);
export type ArtifactWorkspaceEvent = z.infer<typeof artifactWorkspaceEventSchema>;
