/**
 * [INPUT]: Depends on admitted crypto, complete authenticated Home metadata and current owned filesystem evidence.
 * [OUTPUT]: Applies complete authenticated snapshots, removes missing managed files and preserves untracked local files with cancellation and path/byte checks.
 * [POS]: Local execution preparation collaborator; it never claims execution or starts an Agent.
 */
import { realpath } from "node:fs/promises";
import { canonicalJson, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { HomeEntry } from "@ai-chat/cloud-protocol/chats/home/model";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted/model";
import type { ChatHomeService } from "../../../chat-home/chat-home-service";
import type { AccountTransport } from "../../runtime/transport";
import type { DesktopBlobStore } from "../../files/store";
import { readHomeManifest } from "./manifest";
import { matchingHomeFile } from "./matching";
import { ManagedHomeFiles, managedPathKey, removedManagedPaths, retainedManagedPaths } from "./managed";
import { pruneManagedHomeDirectories, removeManagedHomeFile, restoreHomeFile, type HomeTarget } from "./files";
type HomeRestoreResult = { snapshotId: string | null; files: number; bytes: number; omitted: Extract<HomeEntry, { kind: "omitted" }>[] };
export class HomeSnapshotRestorer {
  private active = new Map<string, Promise<HomeRestoreResult>>();
  private stop = new AbortController();
  constructor(private input: { userData: string; config: CloudBuildConfig; userId: string; deviceId: string; crypto(): FileCipherPort; homes: ChatHomeService; files: Pick<DesktopBlobStore, "read">;
    transport: Pick<AccountTransport, "query">; current(head: CloudChatHead): Promise<void> }) {}
  restore(head: CloudChatHead, signal?: AbortSignal) {
    const existing = this.active.get(head.chat.id); if (existing) return Promise.reject(new Error("HOME_RESTORE_IN_PROGRESS"));
    const combined = signal ? AbortSignal.any([this.stop.signal, signal]) : this.stop.signal;
    const flight = this.run(head, combined); this.active.set(head.chat.id, flight);
    void flight.finally(() => this.active.delete(head.chat.id)).catch(() => {}); return flight;
  }
  private async target(head: CloudChatHead, signal: AbortSignal): Promise<HomeTarget> {
    const record = this.input.homes.ledger.get(head.chat.id);
    if (!record || record.incarnationId !== head.chat.incarnationId) throw new Error("HOME_OWNERSHIP_UNAVAILABLE");
    const original = await this.input.homes.committedCreationEvidence(head.chat.id, record.intentId), root = await realpath(record.homeDir);
    return { root, worktree: record.worktree?.relativePath, verify: async () => {
      signal.throwIfAborted(); await this.input.current(head); signal.throwIfAborted();
      const current = await this.input.homes.committedCreationEvidence(head.chat.id, record.intentId);
      if (canonicalJson(current) !== canonicalJson(original) || await realpath(record.homeDir) !== root) throw new Error("HOME_IDENTITY_CHANGED");
    } };
  }
  private async run(head: CloudChatHead, signal: AbortSignal): Promise<HomeRestoreResult> {
    signal.throwIfAborted(); await this.input.current(head);
    const snapshot = await readHomeManifest(this.input, head, signal);
    if (!snapshot) return { snapshotId: null, files: 0, bytes: 0, omitted: [] };
    const downloaded = new Map<string, string>(), matched = new Map<string, () => Promise<void>>();
    const target = await this.target(head, signal); await target.verify();
    for (const entry of snapshot?.entries ?? []) if (entry.kind === "file") {
      signal.throwIfAborted(); await this.input.current(head);
      const unchanged = await matchingHomeFile(target, entry, signal);
      if (unchanged) { matched.set(entry.path, unchanged); continue; }
      const descriptor = snapshot?.descriptors.get(entry.path); if (!descriptor) throw new Error("HOME_FILE_MANIFEST_REQUIRED");
      const file = await this.input.files.read(descriptor, { kind: "chat", id: head.chat.id }, signal);
      if (canonicalJson(file.descriptor) !== canonicalJson(descriptor)) throw new Error("HOME_RESTORE_SOURCE_CHANGED");
      downloaded.set(entry.path, file.path);
    }
    for (const verify of matched.values()) await verify();
    const record = this.input.homes.ledger.get(head.chat.id)!;
    const managed = new ManagedHomeFiles(this.input.userData, [{ environment: this.input.config.environmentId, userId: this.input.userId },
      { id: head.chat.id, incarnationId: head.chat.incarnationId }, record.intentId]);
    const previous = await managed.read(), entries = snapshot?.entries ?? [];
    const next = retainedManagedPaths(previous, entries);
    // Journal the union before writes: a partial restore remains managed on retry.
    await managed.write([...previous, ...next]);
    const removed = removedManagedPaths(previous, next);
    for (const path of removed) await removeManagedHomeFile(target, path, signal, [...previous, ...next].some(value => managedPathKey(value).startsWith(managedPathKey(path) + "/")));
    await pruneManagedHomeDirectories(target, removed, signal);
    for (const entry of snapshot?.entries ?? []) if (entry.kind === "file") {
      const verify = matched.get(entry.path);
      if (verify) await verify(); else await restoreHomeFile(target, snapshot!.manifest.snapshotId, entry, downloaded.get(entry.path)!, signal);
    }
    await target.verify(); await managed.write(next);
    return { snapshotId: snapshot?.manifest.snapshotId ?? null, files: snapshot?.entries.filter(entry => entry.kind === "file").length ?? 0,
      bytes: snapshot?.manifest.bytes ?? 0, omitted: snapshot?.entries.filter((entry): entry is Extract<HomeEntry, { kind: "omitted" }> => entry.kind === "omitted") ?? [] };
  }
  async close() { this.stop.abort(); await Promise.allSettled([...this.active.values()]); }
}
