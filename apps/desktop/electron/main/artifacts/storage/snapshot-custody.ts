/**
 * [INPUT]: Admitted immutable bytes, exact Chat incarnations and parent-synced persistence primitives.
 * [OUTPUT]: Immutable snapshot reads with or without live metadata, custody promotion, restart reconstruction, independent Fork references and opaque unsupported records without index migration.
 * [POS]: Local artifact authority independent of cloud credentials or key availability; bytes live beside their Chat in the folder, so Chat deletion collects them with the directory.
 */
import { storedArtifactFenceSchema, unsupportedArtifactFence } from "./retained/fence";
import { ArtifactFailure } from "./failure";
import { z } from "zod";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { artifactFenceSchema, type ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { artifactRefSchema, ARTIFACT_BUDGET, type ArtifactRef } from "../../../../shared/ipc/apps/artifact-ipc";
import { DurableJson, durableReplaceBytes } from "../../persistence/durable-json";
import { SerialQueue } from "../../persistence/serial-queue";
import { artifactHash } from "../admission/files";
import { artifactExtension } from "@ai-chat/cloud-protocol/artifacts/media-types";
import { libraryChatPath, libraryDirectory, libraryObjectId } from "../../library/paths";
const recordSchema = z.object({ ref: artifactRefSchema, fence: artifactFenceSchema, messageId: z.string().max(128), committed: z.boolean(), remote: z.string().max(1024).optional(),
  derivedFrom: z.object({ artifactId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional() }).strict();
const storedRecordSchema = recordSchema.omit({ fence: true }).extend({
  fence: storedArtifactFenceSchema,
}).strict().superRefine((value, context) => {
  if (unsupportedArtifactFence(value.fence)) return;
  if (!recordSchema.safeParse(value).success) context.addIssue({ code: "custom", message: "Invalid current Artifact record" });
});
const schema = z.object({ v: z.literal(2), records: z.array(storedRecordSchema), releasedChats: z.array(z.string()) }).strict();
export type ArtifactRecord = z.infer<typeof recordSchema>;
const key = (ref: ArtifactRef) => JSON.stringify([ref.chatId, ref.incarnationId, ref.artifactId]);
const chatKey = (ref: Pick<ArtifactRef, "chatId" | "incarnationId">) => JSON.stringify([ref.chatId, ref.incarnationId]);
export class SnapshotCustody {
  private readonly index: DurableJson<z.infer<typeof schema>>;
  /* Every gateway request and every authorization looks a record up; DurableJson.snapshot() clones the
     whole index per call, so the mirror is rebuilt once per mutation instead. */
  private readonly mirror = new Map<string, ArtifactRecord>();
  private readonly queue = new SerialQueue();
  constructor(readonly root: string, private libraryRoot: () => string | null) { this.index = new DurableJson(join(root, "index.json"), schema, () => ({ v: 2, records: [], releasedChats: [] })); }
  async initialize() {
    await this.index.initialize();
    this.refresh();
  }
  private refresh() {
    this.mirror.clear();
    for (const value of this.index.snapshot().records) {
      if (unsupportedArtifactFence(value.fence)) continue;
      const record = recordSchema.safeParse(value);
      if (record.success && !record.data.fence.rejected) this.mirror.set(key(record.data.ref), record.data);
    }
  }
  private async write(operation: (state: z.infer<typeof schema>) => void) { await this.index.mutate(operation); this.refresh(); }
  records() { return [...this.mirror.values()]; }
  lookup(ref: ArtifactRef) { return this.mirror.get(key(ref)) ?? null; }
  path(fence: ArtifactFence, ref?: ArtifactRef) {
    if (!fence.sha256 || !/^[a-f0-9]{64}$/.test(fence.sha256)) throw new Error("artifact-unavailable");
    const extension = artifactExtension(fence);
    const root = this.libraryRoot();
    if (!root || !ref) throw new Error("artifact-folder-unavailable");
    return join(libraryChatPath(root, ref.chatId), "artifacts", libraryObjectId(ref.artifactId), "snapshot." + extension);
  }
  async read(ref: ArtifactRef) {
    const record = this.lookup(ref);
    if (!record) throw new Error("artifact-unavailable");
    return { record, ...await this.readSnapshot(ref, record.fence) };
  }
  async readSnapshot(ref: ArtifactRef, fence: ArtifactFence) {
    const path = this.path(fence, ref), metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== fence.bytes) throw new Error("artifact-unavailable");
    const data = await readFile(path);
    if (artifactHash(data) !== fence.sha256) throw new Error("artifact-integrity");
    return { data, path };
  }
  retain(record: ArtifactRecord, data?: Uint8Array) {
    return this.queue.enqueue(async () => {
      record = recordSchema.parse(record);
      const state = this.index.snapshot();
      if (state.releasedChats.includes(chatKey(record.ref))) throw new Error("artifact-released");
      if (unsupportedArtifactFence(record.fence) || state.records.some(value => key(value.ref) === key(record.ref) && unsupportedArtifactFence(value.fence))) throw new Error("artifact-unavailable");
      const previous = this.lookup(record.ref);
      if (previous) {
        if (previous.fence.sha256 !== record.fence.sha256) throw new Error("artifact-identity-conflict");
        record = { ...previous, committed: previous.committed || record.committed };
      }
      const fence = record.fence;
      const root = this.libraryRoot(); if (!root) throw new Error("artifact-folder-unavailable");
      await libraryDirectory(root, "chats", record.ref.chatId, "artifacts", record.ref.artifactId);
      if (!fence.sha256 || fence.bytes === undefined) throw new Error("artifact-unavailable");
      const sum = (records: readonly z.infer<typeof storedRecordSchema>[]) => [...new Map(records.flatMap(value => { if (unsupportedArtifactFence(value.fence)) return []; const parsed = recordSchema.safeParse(value); return parsed.success && !parsed.data.fence.rejected && parsed.data.fence.sha256 ? [[this.path(parsed.data.fence, parsed.data.ref), parsed.data.fence.bytes ?? 0] as const] : []; })).values()].reduce((total, bytes) => total + bytes, 0);
      const next = previous ? state.records : [...state.records, record];
      if (sum(next) > ARTIFACT_BUDGET.global || sum(next.filter(value => value.ref.chatId === record.ref.chatId)) > ARTIFACT_BUDGET.chat) throw new ArtifactFailure("budget", "retain");
      if (data) {
        if (data.length !== fence.bytes || artifactHash(data) !== fence.sha256) throw new Error("artifact-integrity");
        const existing = await readFile(this.path(fence, record.ref)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return null; });
        if (existing && (existing.length !== fence.bytes || artifactHash(existing) !== fence.sha256)) throw new Error("artifact-integrity");
        if (!existing) await durableReplaceBytes(this.path(fence, record.ref), data);
      } else {
        const bytes = await readFile(this.path(fence, record.ref));
        if (bytes.length !== fence.bytes || artifactHash(bytes) !== fence.sha256) throw new Error("artifact-integrity");
      }
      if (!previous) await this.write(state => { state.records.push(record); });
      else if (record.committed !== previous.committed) await this.write(state => { const current = state.records.find(value => key(value.ref) === key(record.ref)); if (current) current.committed = record.committed; });
      return record;
    });
  }
  commit(chatId: string, messageId: string, retained: ReadonlySet<string>) {
    return this.queue.enqueue(async () => {
      await this.write(state => {
        state.records = state.records.filter(record => unsupportedArtifactFence(record.fence) || record.ref.chatId !== chatId || record.messageId !== messageId || retained.has(record.derivedFrom?.artifactId ?? record.fence.id));
        for (const record of state.records) if (!unsupportedArtifactFence(record.fence) && record.ref.chatId === chatId && record.messageId === messageId) record.committed = true;
      });
    });
  }
  release(ref: ArtifactRef) {
    return this.queue.enqueue(async () => {
      await this.write(state => { state.records = state.records.filter(record => unsupportedArtifactFence(record.fence) || key(record.ref) !== key(ref)); });
    });
  }
  releaseChat(chatId: string, incarnationId: string) {
    return this.queue.enqueue(async () => {
      await this.write(state => {
        const identity = chatKey({ chatId, incarnationId });
        if (!state.releasedChats.includes(identity)) state.releasedChats.push(identity);
        state.records = state.records.filter(record => chatKey(record.ref) !== identity);
      });
    });
  }
  async fork(source: ArtifactRef, target: ArtifactRef, messageId: string) {
    const record = this.lookup(source);
    if (!record) throw new Error("artifact-unavailable");
    return this.retain({ ...record, ref: target, messageId, committed: true, remote: undefined }, (await this.read(source)).data);
  }
  async close() { this.queue.close(); await this.queue.flush(); await this.index.closeAndFlush(); }
}
