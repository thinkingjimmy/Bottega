/**
 * [INPUT]: Main-frozen capture roots, exact Chat/reference identity and typed capture facts.
 * [OUTPUT]: Durable retry arguments, original retained-byte identities, latest failures and immutable recovered fences.
 * [POS]: Private capture recovery ledger; local paths never cross the renderer or Cloud boundary.
 */
import { z } from "zod";
import { join } from "node:path";
import { DurableJson } from "../../persistence/durable-json";
import { artifactRefSchema, type ArtifactRef } from "../../../../shared/ipc/apps/artifact-ipc";
import { artifactFenceSchema, type ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
const capture = z.object({ ref: artifactRefSchema, roots: z.object({ workspace: z.string(), artifacts: z.string(), sessionId: z.string().optional(), session: z.string().optional() }).strict(),
  reference: z.object({ path: z.string(), title: z.string().optional(), mode: z.literal("wide").optional() }).strict(),
  generation: z.string(), messageId: z.string(), candidate: artifactFenceSchema.optional(), failure: artifactFenceSchema.optional(), fence: artifactFenceSchema.optional() }).strict();
const schema = z.object({ captures: z.array(capture) }).strict();
const key = (ref: ArtifactRef) => JSON.stringify([ref.chatId, ref.incarnationId, ref.artifactId]);
export class ArtifactRecovery {
  private readonly file: DurableJson<z.infer<typeof schema>>;
  constructor(root: string) { this.file = new DurableJson(join(root, "capture-recovery.json"), schema, () => ({ captures: [] })); }
  initialize() { return this.file.initialize(); }
  read(ref: ArtifactRef) { return this.file.read(value => value.captures.find(row => key(row.ref) === key(ref))); }
  prepare(input: z.infer<typeof capture>) { return this.file.mutate(value => { if (!value.captures.some(row => key(row.ref) === key(input.ref))) value.captures.push(input); }); }
  preserve(ref: ArtifactRef, fence: ArtifactFence) { return this.file.mutate(value => { const row = value.captures.find(row => key(row.ref) === key(ref)); if (!row) return; if (row.candidate && row.candidate.sha256 !== fence.sha256) throw new Error("artifact-identity-conflict"); row.candidate = fence; }); }
  fail(ref: ArtifactRef, failure: ArtifactFence) { return this.file.mutate(value => { const row = value.captures.find(row => key(row.ref) === key(ref)); if (row && !row.fence) row.failure = failure; }); }
  releaseChat(chatId: string, incarnationId: string) { return this.file.mutate(value => { value.captures = value.captures.filter(row => row.ref.chatId !== chatId || row.ref.incarnationId !== incarnationId); }); }
  complete(ref: ArtifactRef, fence: ArtifactFence) { return this.file.mutate(value => { const row = value.captures.find(row => key(row.ref) === key(ref)); if (!row) throw new Error("artifact-recovery-missing"); if (row.fence && row.fence.sha256 !== fence.sha256) throw new Error("artifact-identity-conflict"); row.fence = fence; delete row.failure; }); }
  release(ref: ArtifactRef) { return this.file.mutate(value => { value.captures = value.captures.filter(row => key(row.ref) !== key(ref)); }); }
  close() { return this.file.closeAndFlush(); }
}
