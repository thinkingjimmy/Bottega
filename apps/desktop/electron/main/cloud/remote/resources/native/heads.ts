/**
 * [INPUT]: Verified native current-head metadata, original owner checkpoint CAS state and account-scoped Artifact file transfer.
 * [OUTPUT]: NativeHeadMaterials issues two-active/eight-waiting operator/Chat-bound source and recovery file capabilities independent of publication progress.
 * [POS]: Ephemeral native read material; original custody and checkpoint stores remain the only durable authorities.
 */
import { randomUUID } from "node:crypto";
import { SerialQueue } from "../../../../persistence/serial-queue";
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { NativeRemoteInput, NativeRemoteResult, NativeRemoteFile } from "@ai-chat/cloud-protocol/resources/artifact/native";
import { NativeFileTransfer, nativeBytesSource } from "@ai-chat/cloud-protocol/artifacts/design/remote/files";
import type { DesktopBlobStore } from "../../../files/store";
import { artifactRuntime } from "../../../../artifacts/core/runtime";
import { designDigest } from "../../../../design/documents/model";
type Operator = { userId: string; deviceId: string };
type Head = Omit<Extract<NativeRemoteResult, { kind: "head" }>, "materialId" | "token" | "expiresAt">;
type Record = { id: string; token: string; identity: string; expiresAt: number; scope: Extract<NativeRemoteInput, { kind: "head" }>;
  operator: Operator; head: Head; recovery: Uint8Array; current(): void; files: DesktopBlobStore; transfer: NativeFileTransfer; tasks: Map<string, Promise<NativeRemoteFile>> };
export class NativeHeadMaterials {
  private readonly records = new Map<string, Record>();
  private readonly queues = [new SerialQueue(), new SerialQueue()];
  private readonly pending = [0, 0];
  constructor(private readonly ports: { config: CloudBuildConfig; files(userId: string): DesktopBlobStore }) {}
  private async release(record: Record) { if (!this.records.delete(record.id)) return; await record.transfer.close(); await record.files.close(); }
  prune() { for (const record of this.records.values()) { try { record.current(); if (record.expiresAt <= Date.now()) throw new Error("expired"); } catch { void this.release(record); } } }
  async issue(scope: Record["scope"], operator: Operator, current: () => void, head: Head, recovery: unknown) {
    this.prune(); current(); const bytes = Buffer.from(JSON.stringify(recovery));
    if (bytes.length > 2 * 1024 * 1024) throw new Error("artifact-budget");
    const identity = designDigest(JSON.stringify([scope, operator, head, designDigest(bytes)]));
    const before = [...this.records.values()].find(record => record.identity === identity);
    if (before) return { ...head, materialId: before.id, token: before.token, expiresAt: before.expiresAt };
    if (this.records.size >= 16) await this.release(this.records.values().next().value!);
    const files = this.ports.files(operator.userId), id = randomUUID();
    const transfer = new NativeFileTransfer(files.transfer, () => {
      current(); const crypto = files.transfer.crypto;
      if (crypto.session.userId !== operator.userId) throw new Error("artifact-unavailable");
      return { ...protocolHeader(this.ports.config), expectedUserId: operator.userId, encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
    }, scope.chatId);
    const record: Record = { id, token: randomUUID(), identity, expiresAt: Date.now() + 120_000, scope: { ...scope }, operator: { ...operator }, head, recovery: bytes, current, files, transfer, tasks: new Map() };
    this.records.set(id, record); return { ...head, materialId: id, token: record.token, expiresAt: record.expiresAt };
  }
  async read(input: Extract<NativeRemoteInput, { kind: "head-material" }>, operator: Operator): Promise<NativeRemoteResult> {
    this.prune(); const record = this.records.get(input.materialId);
    if (!record || record.token !== input.token || JSON.stringify(record.operator) !== JSON.stringify(operator) ||
      ["chatId", "incarnationId", "artifactId"].some(key => input[key as keyof typeof input] !== record.scope[key as keyof typeof record.scope])) throw new Error("artifact-unavailable");
    record.current(); let task = record.tasks.get(input.material);
    if (!task) {
      if (this.pending[0]! + this.pending[1]! >= 10) throw new Error("artifact-budget");
      const index = this.pending[0]! <= this.pending[1]! ? 0 : 1; this.pending[index]!++;
      task = this.queues[index]!.enqueue(async () => {
        record.current();
        if (record.expiresAt <= Date.now() || this.records.get(record.id) !== record) throw new Error("artifact-unavailable");
        const source = input.material === "source" ? (await artifactRuntime()!.resolve({ chatId: record.scope.chatId, incarnationId: record.scope.incarnationId, artifactId: record.head.fence.id })).data : record.recovery;
        record.current(); if (this.records.get(record.id) !== record) throw new Error("artifact-unavailable");
        if (input.material === "source" && designDigest(source) !== record.head.snapshotRef) throw new Error("artifact-integrity");
        return record.transfer.stage(record.id + ":" + input.material, nativeBytesSource(source, input.material === "source" ? "application/x-tar" : "application/json"));
      }).finally(() => { this.pending[index]!--; });
      const original = task;
      task = original.catch(cause => { if (record.tasks.get(input.material) === task) record.tasks.delete(input.material); throw cause; });
      record.tasks.set(input.material, task);
    }
    const file = await task; record.current(); if (this.records.get(record.id) !== record) throw new Error("artifact-unavailable"); return { kind: "material", file };
  }
  async close() {
    for (const queue of this.queues) queue.close();
    await Promise.all([...this.records.values()].map(record => this.release(record)));
    await Promise.all(this.queues.map(queue => queue.flush()));
  }
}
