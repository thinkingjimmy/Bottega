/**
 * [INPUT]: Depends on bounded live reduction, immutable replacement frames and existing chunk contracts.
 * [OUTPUT]: Coalesces pending events into one bounded projection while preserving every frozen in-flight chunk.
 * [POS]: Ephemeral recorder buffer; durable scheduling and receipts remain in the original SQLite outbox.
 */
import { LIVE_TURN_LIMITS, type LiveEvent, type LiveProjection, type TurnChunk } from "@ai-chat/cloud-protocol/turns/live";
import { createLiveProjection, reduceLiveProjection } from "@ai-chat/cloud-protocol/turns/projection";
import { replacementEvents } from "@ai-chat/cloud-protocol/turns/replacement";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { chunkEvents } from "./events";
export class LiveCaptureBuffer {
  private projection: LiveProjection;
  private events: LiveEvent[] = [];
  private bytes = 0;
  private replacement = false;
  private writes: TurnChunk[] = [];
  private written = 0;
  initialized = false;
  terminal = false;
  constructor(startedAt: number) { this.projection = createLiveProjection(startedAt); }
  append(event: LiveEvent) {
    if (this.terminal) return;
    const bytes = Buffer.byteLength(JSON.stringify(event));
    if (this.events.length >= LIVE_TURN_LIMITS.bufferEvents || this.bytes + bytes > LIVE_TURN_LIMITS.bufferBytes) {
      this.projection = reduceLiveProjection(this.projection, this.events); this.events = []; this.bytes = 0; this.replacement = true;
    }
    this.events.push(event); this.bytes += bytes;
    if (event.type === "terminal") this.terminal = true;
  }
  replace(projection: LiveProjection, initialize = false) {
    if (this.terminal && !initialize) return;
    const oldTerminal = this.events.find(event => event.type === "terminal");
    const terminal = projection.terminal ?? (initialize ? oldTerminal?.type === "terminal" ? oldTerminal.terminal : this.projection.terminal : null);
    this.projection = { ...projection, terminal }; this.events = []; this.bytes = 0; this.replacement = true;
    this.terminal = terminal !== null;
  }
  resumeReplacement(snapshotId: string, afterSeq: number) {
    if (this.writes.length) throw new Error("LIVE_CAPTURE_ALREADY_STARTED");
    this.writes = chunkEvents([{ type: "replacement-abort", snapshotId }], afterSeq); this.written = 0;
  }
  confirmedTerminal() { this.terminal = true; this.events = []; this.writes = []; this.written = 0; this.bytes = 0; this.replacement = false; }
  next(afterSeq: number, renew = true): TurnChunk | null {
    if (this.written < this.writes.length) return this.writes[this.written]!;
    if (!renew) return null;
    this.writes = []; this.written = 0;
    if (!this.replacement && !this.events.length) return null;
    this.projection = reduceLiveProjection(this.projection, this.events);
    if (this.replacement) {
      const terminal = this.projection.terminal, snapshot = { ...this.projection, terminal: null };
      const events = [...replacementEvents(hashChatContent([afterSeq, snapshot]), snapshot), ...(terminal ? [{ type: "terminal" as const, terminal }] : [])];
      this.writes = chunkEvents(events, afterSeq);
    } else this.writes = chunkEvents(this.events, afterSeq);
    this.events = []; this.bytes = 0; this.replacement = false;
    return this.writes[this.written] ?? null;
  }
  acknowledge(chunk: TurnChunk) {
    if (this.writes[this.written] !== chunk) throw new Error("LIVE_CAPTURE_CHUNK_CHANGED");
    this.written++;
  }
  get retainedBytes() {
    return Buffer.byteLength(JSON.stringify(this.projection)) + this.bytes + this.writes.reduce((sum, chunk) => sum + Buffer.byteLength(JSON.stringify(chunk)), 0);
  }
}
