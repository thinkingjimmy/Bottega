/**
 * [INPUT]: Admitted immutable bytes, exact Chat incarnations and parent-synced persistence primitives.
 * [OUTPUT]: Cross-Chat reference-counted snapshots, restart reconstruction and independent Fork references.
 * [POS]: Local artifact authority independent of cloud credentials or key availability; bytes live beside their Chat in the folder, so Chat deletion collects them with the directory.
 */
import { z } from "zod";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { artifactFenceSchema, type ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { artifactRefSchema, ARTIFACT_BUDGET, type ArtifactRef } from "../../../../shared/artifact-ipc";
import { DurableJson, durableReplaceBytes } from "../../persistence/durable-json";
import { SerialQueue } from "../../persistence/serial-queue";
import { artifactHash } from "../admission";
import { libraryChatPath, libraryDirectory, libraryObjectId } from "../../library/paths";
const recordSchema = z.object({ ref: artifactRefSchema, fence: artifactFenceSchema, messageId: z.string().max(128), committed: z.boolean(), remote: z.string().max(1024).optional() }).strict();
const schema = z.object({ v: z.literal(1), records: z.array(recordSchema), releasedChats: z.array(z.string()) }).strict();
export type ArtifactRecord = z.infer<typeof recordSchema>;
const key = (ref: ArtifactRef) => JSON.stringify([ref.chatId, ref.incarnationId, ref.artifactId]);
const chatKey = (ref: Pick<ArtifactRef, "chatId" | "incarnationId">) => JSON.stringify([ref.chatId, ref.incarnationId]);
export class SnapshotCustody {
  private readonly index: DurableJson<z.infer<typeof schema>>;
  /* Every gateway request and every authorization looks a record up; DurableJson.snapshot() clones the
     whole index per call, so the mirror is rebuilt once per mutation instead. */
  private readonly mirror = new Map<string, ArtifactRecord>();
  private readonly queue = new SerialQueue();
  constructor(readonly root: string, private libraryRoot: () => string | null) { this.index = new DurableJson(join(root, "index.json"), schema, () => ({ v: 1, records: [], releasedChats: [] })); }
  async initialize() {
    await this.index.initialize();
    this.refresh();
  }
  private refresh() { this.mirror.clear(); for (const record of this.index.snapshot().records) this.mirror.set(key(record.ref), record); }
  private async write(operation: (state: z.infer<typeof schema>) => void) { await this.index.mutate(operation); this.refresh(); }
  records() { return [...this.mirror.values()]; }
  lookup(ref: ArtifactRef) { return this.mirror.get(key(ref)) ?? null; }
  path(fence: ArtifactFence, ref?: ArtifactRef) {
    if (!fence.sha256 || !/^[a-f0-9]{64}$/.test(fence.sha256)) throw new Error("artifact-unavailable");
    const extension = ({ "html-fragment": "html", "html-document": "html", "static-site": "tar", markdown: "md", svg: "svg", image: "img", pdf: "pdf", docx: "docx", pptx: "pptx", xlsx: "xlsx", csv: "csv" } as Record<string, string>)[fence.kind] ?? "bin";
    const root = this.libraryRoot();
    if (!root || !ref) throw new Error("artifact-folder-unavailable");
    return join(libraryChatPath(root, ref.chatId), "artifacts", libraryObjectId(ref.artifactId), "snapshot." + extension);
  }
  async read(ref: ArtifactRef) {
    const record = this.lookup(ref);
    if (!record) throw new Error("artifact-unavailable");
    const path = this.path(record.fence, record.ref), metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== record.fence.bytes) throw new Error("artifact-unavailable");
    const data = await readFile(path);
    if (artifactHash(data) !== record.fence.sha256) throw new Error("artifact-integrity");
    return { record, data, path };
  }
  retain(record: ArtifactRecord, data?: Uint8Array) {
    return this.queue.enqueue(async () => {
      record = recordSchema.parse(record);
      const state = this.index.snapshot();
      if (state.releasedChats.includes(chatKey(record.ref))) throw new Error("artifact-released");
      const previous = state.records.find(value => key(value.ref) === key(record.ref));
      if (previous) {
        if (previous.fence.sha256 !== record.fence.sha256) throw new Error("artifact-identity-conflict");
        record = previous;
      }
      const fence = record.fence;
      const root = this.libraryRoot(); if (!root) throw new Error("artifact-folder-unavailable");
      await libraryDirectory(root, "chats", record.ref.chatId, "artifacts", record.ref.artifactId);
      if (!fence.sha256 || fence.bytes === undefined) throw new Error("artifact-unavailable");
      const sum = (records: ArtifactRecord[]) => [...new Map(records.map(value => [this.path(value.fence, value.ref), value.fence.bytes ?? 0])).values()].reduce((total, bytes) => total + bytes, 0);
      const next = previous ? state.records : [...state.records, record];
      if (sum(next) > ARTIFACT_BUDGET.global || sum(next.filter(value => value.ref.chatId === record.ref.chatId)) > ARTIFACT_BUDGET.chat) throw new Error("budget");
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
      return record;
    });
  }
  commit(chatId: string, messageId: string, retained: ReadonlySet<string>) {
    return this.queue.enqueue(async () => {
      await this.write(state => {
        state.records = state.records.filter(record => record.ref.chatId !== chatId || record.messageId !== messageId || retained.has(record.fence.id));
        for (const record of state.records) if (record.ref.chatId === chatId && record.messageId === messageId) record.committed = true;
      });
    });
  }
  release(ref: ArtifactRef) {
    return this.queue.enqueue(async () => {
      await this.write(state => { state.records = state.records.filter(record => key(record.ref) !== key(ref)); });
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
