/**
 * [INPUT]: Main-frozen capture roots, exact Chat/reference identity and typed capture facts.
 * [OUTPUT]: Current retry arguments and immutable recovered fences, with opaque unsupported captures retained outside executable recovery.
 * [POS]: Private capture recovery ledger; local paths never cross the renderer or Cloud boundary.
 */
import { z } from "zod";
import { join } from "node:path";
import { DurableJson } from "../../persistence/durable-json";
import { artifactRefSchema, type ArtifactRef } from "../../../../shared/ipc/apps/artifact-ipc";
import { artifactFenceSchema, type ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { storedArtifactFenceSchema, unsupportedArtifactFence } from "./retained/fence";
const capture = z.object({ ref: artifactRefSchema, roots: z.object({ workspace: z.string(), artifacts: z.string(), sessionId: z.string().optional(), session: z.string().optional() }).strict(),
  reference: z.object({ path: z.string(), title: z.string().optional(), mode: z.literal("wide").optional() }).strict(),
  generation: z.string(), messageId: z.string(), candidate: artifactFenceSchema.optional(), failure: artifactFenceSchema.optional(), fence: artifactFenceSchema.optional() }).strict();
type Capture = z.infer<typeof capture>;
type FenceMetadata = Parameters<typeof unsupportedArtifactFence>[0];
function unsupportedCapture(row: { candidate?: FenceMetadata; failure?: FenceMetadata; fence?: FenceMetadata }) {
  return [row.candidate, row.failure, row.fence].some(value => value && unsupportedArtifactFence(value));
}
const storedCapture = capture.omit({ candidate: true, failure: true, fence: true }).extend({
  candidate: storedArtifactFenceSchema.optional(), failure: storedArtifactFenceSchema.optional(), fence: storedArtifactFenceSchema.optional(),
}).strict().superRefine((value, context) => {
  if (!unsupportedCapture(value) && !capture.safeParse(value).success) context.addIssue({ code: "custom", message: "Invalid current Artifact capture" });
});
const schema = z.object({ captures: z.array(storedCapture) }).strict();
const key = (ref: ArtifactRef) => JSON.stringify([ref.chatId, ref.incarnationId, ref.artifactId]);
export class ArtifactRecovery {
  private readonly file: DurableJson<z.infer<typeof schema>>;
  constructor(root: string) { this.file = new DurableJson(join(root, "capture-recovery.json"), schema, () => ({ captures: [] })); }
  initialize() { return this.file.initialize(); }
  read(ref: ArtifactRef) { return this.file.read(value => { const row = value.captures.find(row => key(row.ref) === key(ref)); return row && !unsupportedCapture(row) ? capture.parse(row) : undefined; }); }
  prepare(input: Capture) {
    const current = capture.parse(input); if (unsupportedCapture(current)) throw new Error("Unsupported Artifact capture");
    return this.file.mutate(value => { if (!value.captures.some(row => key(row.ref) === key(current.ref))) value.captures.push(current); });
  }
  private change(ref: ArtifactRef, update: (row: Capture) => void, required = false) {
    return this.file.mutate(value => {
      const index = value.captures.findIndex(row => key(row.ref) === key(ref)), raw = value.captures[index];
      if (!raw || unsupportedCapture(raw)) { if (required) throw new Error("artifact-recovery-missing"); return; }
      const row = capture.parse(raw); update(row); value.captures[index] = row;
    });
  }
  private fence(value: ArtifactFence) { const fence = artifactFenceSchema.parse(value); if (unsupportedArtifactFence(fence)) throw new Error("Unsupported Artifact capture"); return fence; }
  preserve(ref: ArtifactRef, value: ArtifactFence) { const fence = this.fence(value); return this.change(ref, row => { if (row.candidate && row.candidate.sha256 !== fence.sha256) throw new Error("artifact-identity-conflict"); row.candidate = fence; }); }
  fail(ref: ArtifactRef, value: ArtifactFence) { const failure = this.fence(value); return this.change(ref, row => { if (!row.fence) row.failure = failure; }); }
  releaseChat(chatId: string, incarnationId: string) { return this.file.mutate(value => { value.captures = value.captures.filter(row => unsupportedCapture(row) || row.ref.chatId !== chatId || row.ref.incarnationId !== incarnationId); }); }
  complete(ref: ArtifactRef, value: ArtifactFence) { const fence = this.fence(value); return this.change(ref, row => { if (row.fence && row.fence.sha256 !== fence.sha256) throw new Error("artifact-identity-conflict"); row.fence = fence; delete row.failure; }, true); }
  release(ref: ArtifactRef) { return this.file.mutate(value => { value.captures = value.captures.filter(row => unsupportedCapture(row) || key(row.ref) !== key(ref)); }); }
  close() { return this.file.closeAndFlush(); }
}
