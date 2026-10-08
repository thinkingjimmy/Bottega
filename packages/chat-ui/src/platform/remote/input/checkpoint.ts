/**
 * [INPUT]: Depends on ./checkpoint-model for the port and the closed checkpoint shape, and on the draft store's custody view.
 * [OUTPUT]: Persists plugin bytes as bounded blob parts, re-exports the checkpoint model; checkpointOf and DraftCheckpointBinder (read-then-write, debounced, rekey on handoff). flushStrict persists queue recovery before a remote mutation; submitted settings and operation journals share the same checkpoint.
 * [POS]: W23 recovery contract of remote drafts; the host owns keys, storage and account cleanup, this file owns what is saved and when.
 */
import { REMOTE_ATTACHMENT_BYTES } from "@ai-chat/cloud-protocol/remote/input/model";
import { blobKey, parseCheckpoint, type CheckpointFile, type DraftCheckpoint, type RemoteDraftCheckpointPort } from "./checkpoint-model";
import { checkpointPluginSource } from "../../../plugins/checkpoint";
import type { DraftCustody, DraftFile, RemoteDraftStore } from "./draft";
export * from "./checkpoint-model";
const PROCESSED = new Set<DraftFile["state"]>(["queued", "uploading", "ready", "failed"]);
function entry(file: DraftFile, blobs: Map<string, Blob>): CheckpointFile | null {
  const kind = PROCESSED.has(file.state) ? "processed" : file.state === "processing" && file.file.size <= REMOTE_ATTACHMENT_BYTES ? "source"
    : file.state === "processing" || file.state === "reselect" ? "reselect" : null;
  if (!kind) return null;
  const value: CheckpointFile = { id: file.id, uploadId: file.uploadId, name: file.file.name, mime: file.file.type, image: file.image, kind,
    ...(file.sketch !== undefined ? { sketch: file.sketch } : {}), ...(file.pluginSource ? { pluginSource: checkpointPluginSource(file.id, file.pluginSource, blobs) } : {}), ...(file.attachment ? { attachment: file.attachment } : {}), ...(file.attachment && file.readyAt ? { readyAt: file.readyAt } : {}) };
  if (kind !== "reselect") blobs.set(blobKey(value), file.file);
  return value;
}
/** Everything needed to rebuild the draft after the page is gone; Full Access consent is never saved and must be confirmed again. */
export function checkpointOf(custody: DraftCustody): { checkpoint: DraftCheckpoint; blobs: Map<string, Blob> } | null {
  const { value, submitted, commands } = custody, blobs = new Map<string, Blob>();
  const files = (list: readonly DraftFile[]) => list.map(file => entry(file, blobs)).filter(file => file !== null);
  const creation = value.creation ? (({ recovered: _recovered, ...rest }) => rest)(value.creation) : null;
  const checkpoint: DraftCheckpoint = { version: 1, text: value.text, retainedText: value.retainedText ?? null, references: value.references,
    permissionMode: value.permissionMode, planMode: value.planMode, options: value.options, dismissedPlans: value.dismissedPlans, files: files(value.files),
    creation: creation ? { ...creation, references: creation.references ? [...creation.references] : undefined } : null,
    submitted: [...submitted].map(([commandId, draft]) => ({ commandId, ...draft, files: files(draft.files) })),
    commands: [...commands.values()],
    recoveries: value.recoveries, queueOperations: value.queueOperations,
    ...(value.local && (value.local.items.length || value.local.gate || value.local.paused)
      ? { local: { items: value.local.items.map(item => ({ ...item, attachments: [...item.attachments], references: [...item.references] })), gate: value.local.gate, paused: value.local.paused } } : {}) };
  const empty = !checkpoint.text.trim() && !checkpoint.retainedText && !checkpoint.references.length && !checkpoint.files.length && !checkpoint.creation &&
    !checkpoint.submitted.length && !checkpoint.commands.length && !checkpoint.local && !checkpoint.queueOperations?.length;
  return empty ? null : { checkpoint, blobs };
}
/**
 * Reads the saved draft once, then saves every change: debounced for typing, immediately when in-flight commands change
 * (a command that may have reached the server must never be lost and resent as a new message). Writes are serialized.
 */
export class DraftCheckpointBinder {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private stopped = false;
  private ready = false;
  private unsubscribe = () => {};
  private stopEnd = () => {};
  private starting: Promise<void> | null = null;
  constructor(private readonly store: RemoteDraftStore, private readonly port: RemoteDraftCheckpointPort, private key: string, private readonly delay = 400) {}
  start() { return this.starting ??= this.initialize(); }
  private async initialize() {
    try {
      const saved = await this.port.read(this.key);
      if (saved && !this.stopped) await this.store.recover(parseCheckpoint(saved.checkpoint), saved.blobs);
    } catch { /* An unreadable checkpoint is a missing one; the next change replaces it. */ }
    if (this.stopped) return;
    this.ready = true;
    // Before the key goes away, the edit still waiting out its debounce is sealed now instead of lost (G-15).
    this.stopEnd = this.port.beforeEnd?.(() => this.settle()) ?? (() => {});
    let commands = this.store.custody().commands;
    this.unsubscribe = this.store.subscribe(() => {
      const next = this.store.custody().commands, changed = next !== commands; commands = next;
      this.schedule(changed);
    });
    this.schedule(false);
  }
  private schedule(immediate: boolean) {
    if (this.stopped || !this.ready) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = immediate ? null : setTimeout(() => { this.timer = null; void this.flush(); }, this.delay);
    if (immediate) void this.flush();
  }
  flush() {
    if (this.stopped || !this.ready) return this.writes;
    const key = this.key, value = checkpointOf(this.store.custody());
    this.writes = this.writes.then(() => value ? this.port.write(key, value.checkpoint, value.blobs) : this.port.remove(key)).catch(() => {});
    return this.writes;
  }
  /** Destructive remote operations require durable recovery before the first network effect. */
  async flushStrict() {
    await this.start();
    if (this.stopped) throw new Error("identity-changed");
    const key = this.key, value = checkpointOf(this.store.custody());
    const write = this.writes.then(() => value ? this.port.write(key, value.checkpoint, value.blobs) : this.port.remove(key));
    this.writes = write.catch(() => {}); await write;
  }
  /** A draft handed to a new route key moves its checkpoint with it. */
  rekey(key: string) {
    if (key === this.key) return;
    const previous = this.key; this.key = key;
    if (this.stopped) return;
    this.writes = this.writes.then(() => this.port.remove(previous)).catch(() => {});
    if (this.ready) void this.flush();
  }
  /** Lifetime end (lock, account change) keeps the saved draft; only the host's explicit account cleanup erases it. */
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; this.unsubscribe(); this.stopEnd(); }
  private settle() {
    if (!this.timer) return this.writes;
    clearTimeout(this.timer); this.timer = null;
    return this.flush();
  }
}
