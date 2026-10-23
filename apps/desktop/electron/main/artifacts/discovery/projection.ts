/**
 * [INPUT]: Private backend text/tool events, live admission state, immutable snapshot admission and exact turn identity.
 * [OUTPUT]: Classifies failures, drains admitted discovery before bounded cancellation and deduplicates delivery by file version.
 * [POS]: Artifact projection before the canonical turn reducer and every renderer/cloud subscriber.
 */
import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { lstat } from "node:fs/promises";
import { artifactFailure } from "../storage/failure";
import { ARTIFACT_LIMIT, ARTIFACT_MARKERS, artifactTailState, encodeArtifactFence, segmentArtifactText, type ArtifactFence, type ArtifactReference } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { AgentTurnItem } from "../../../../shared/ipc/agent/agent-ipc";
import type { ArtifactRoots } from "../admission/files";
import { ArtifactFileDiscovery, claudeArtifactUrls, type ArtifactToolMetadata } from "./files";
type ItemState = { raw: string; published: string; completed: boolean; captures: Map<string, Promise<ArtifactFence>>; snapshots: Map<string, ArtifactFence> };
export type ArtifactProjectionEvent = { type: "item-delta"; itemId: string; text: string } | { type: "item"; item: AgentTurnItem };
export class ArtifactProjection {
  private readonly items = new Map<string, ItemState>();
  private readonly discovery: ArtifactFileDiscovery;
  private readonly extras = new Map<string, ArtifactFence>();
  private lastMessage: string | null = null;
  private count = 0;
  private readonly captureIds = new Set<string>();
  private settled = false;
  private pending: Promise<void> = Promise.resolve();
  private scanQueued = false;
  private readonly cancellation = new AbortController();
  private readonly fileVersions = new Map<string, string>();
  private readonly adopted = new Set<string>();
  private readonly automaticFlights = new Map<string, Promise<{ stamp: string; fence: ArtifactFence }>>();
  private readonly automatic = new Map<string, { stamp: string; fence: ArtifactFence }>();
  constructor(private readonly input: { roots: ArtifactRoots; requestId: string;
    admissionOpen?(): boolean;
    snapshot(reference: ArtifactReference, id: string, signal?: AbortSignal): Promise<ArtifactFence>;
    deliveredDesign?(reference: ArtifactReference): ArtifactFence | undefined;
    release(id: string): Promise<void> }) { this.discovery = new ArtifactFileDiscovery(input.roots); }
  private state(itemId: string) {
    let value = this.items.get(itemId);
    if (!value) { value = { raw: "", published: "", completed: false, captures: new Map(), snapshots: new Map() }; this.items.set(itemId, value); }
    return value;
  }
  private async capture(reference: ArtifactReference, id: string = randomUUID()): Promise<ArtifactFence> {
    const title = (reference.title || basename(reference.path)).slice(0, 250) || "Artifact";
    if (this.cancellation.signal.aborted || !this.admissionOpen()) return { v: 1, id, kind: "file", title, rejected: "unavailable" };
    const delivered = this.input.deliveredDesign?.(reference);
    if (delivered) return delivered;
    if (!this.captureIds.has(id)) { this.captureIds.add(id); this.count++; }
    if (this.count > ARTIFACT_LIMIT) return { v: 1, id, kind: "file", title, rejected: "budget" };
    for (let attempt = 0; ; attempt++) {
      try {
        this.cancellation.signal.throwIfAborted();
        const controller = new AbortController(), signal = AbortSignal.any([this.cancellation.signal, controller.signal]);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const captured = this.input.snapshot(reference, id, signal).then(async fence => {
          if (signal.aborted) { await this.input.release(fence.id); throw signal.reason; }
          return fence;
        });
        try {
          return await Promise.race([captured, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { controller.abort(new Error("Artifact capture deadline exceeded")); reject(controller.signal.reason); }, 10_000);
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          })]);
        } finally { clearTimeout(timer); }
      } catch (cause) {
        const failure = artifactFailure(cause, "capture");
        console.warn("[artifact] capture failed", { requestId: this.input.requestId, artifactId: id,
          stage: failure.stage, code: failure.code, errno: failure.errno, retryable: failure.retryable, attempt: attempt + 1 });
        if (!failure.retryable || attempt >= 2 || this.cancellation.signal.aborted || !this.admissionOpen())
          return { v: 1, id, kind: "file", title, rejected: failure.code };
        await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
      }
    }
  }
  private async stamp(path: string) {
    const value = await lstat(path).catch(() => null);
    return value ? [value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs].join(":") : "missing";
  }
  /* Streaming re-projects the whole accumulated text on every chunk: a reply that can hold no
     reference skips the fence scan, which segmentArtifactText would reproduce verbatim anyway. */
  private plain(raw: string) {
    return !ARTIFACT_MARKERS.some(marker => raw.includes(marker)) && !artifactTailState(raw.slice(raw.lastIndexOf("\n") + 1));
  }
  private async project(itemId: string, finish: "stream" | "complete" | "interrupted") {
    const state = this.state(itemId);
    if (this.plain(state.raw)) return state.raw;
    const occurrences = new Map<string, number>(), result: string[] = [];
    for (const segment of segmentArtifactText(state.raw, finish)) {
      if (segment.type === "text") { result.push(segment.text); continue; }
      if (segment.type === "reference" && this.input.deliveredDesign?.(segment.reference)) {
        result.push(segment.reference.title ?? segment.reference.path);
        continue;
      }
      const path = segment.type === "reference" ? resolve(this.input.roots.workspace, segment.reference.path) : `rejected:${result.length}`;
      const occurrence = occurrences.get(path) ?? 0; occurrences.set(path, occurrence + 1);
      const identity = JSON.stringify([path, occurrence]);
      let fence = state.snapshots.get(identity);
      if (fence?.rejected && finish !== "stream" && ["missing", "changed", "storage", "publish", "unavailable"].includes(fence.rejected)) {
        fence = segment.type === "reference" ? await this.capture(segment.reference, fence.id) : fence;
        if (this.cancellation.signal.aborted) return state.published;
        state.snapshots.set(identity, fence);
      }
      if (!fence) {
        const auto = occurrence === 0 ? this.automatic.get(path) ?? await this.automaticFlights.get(path) : undefined;
        if (auto && auto.stamp === await this.stamp(path)) {
          fence = auto.fence; this.adopted.add(fence.id);
          this.extras.delete(fence.id);
        }
        fence ??= segment.type === "reference" ? await (state.captures.get(identity) ?? (() => {
          const task = (async () => {
            const before = await this.stamp(path), fence = await this.capture(segment.reference);
            if (before === await this.stamp(path)) this.fileVersions.set(fence.id, before);
            return fence;
          })(); state.captures.set(identity, task); return task;
        })()) :
          { v: 1, id: randomUUID(), kind: "html-fragment", title: "Visualization", rejected: segment.reason };
        if (this.cancellation.signal.aborted) return state.published;
        state.snapshots.set(identity, fence);
      }
      result.push(encodeArtifactFence(fence));
    }
    return this.cancellation.signal.aborted ? state.published : result.join("");
  }
  async delta(itemId: string, text: string): Promise<ArtifactProjectionEvent[]> {
    if (this.settled) return [];
    const state = this.state(itemId); state.raw += text; this.lastMessage = itemId;
    const projected = await this.project(itemId, "stream"), previous = state.published;
    state.published = projected;
    if (projected === previous) return [];
    return projected.startsWith(previous) ? [{ type: "item-delta", itemId, text: projected.slice(previous.length) }] :
      [{ type: "item", item: { itemId, kind: "agent-message", title: "Replied", text: projected, status: "running" } }];
  }
  async item(item: AgentTurnItem, metadata?: ArtifactToolMetadata): Promise<AgentTurnItem> {
    if (this.settled) return item;
    if (item.kind === "agent-message") {
      const state = this.state(item.itemId); state.raw = item.text ?? state.raw;
      const completed = item.status !== "running"; this.lastMessage = item.itemId;
      state.published = await this.project(item.itemId, item.status === "failed" ? "interrupted" : completed ? "complete" : "stream");
      state.completed = completed;
      return { ...item, text: state.published };
    }
    if (item.kind === "command") this.discovery.declare(metadata?.title ?? item.title);
    /* Discovery walks repositories; the projection lane is serial, so every later delta
       would wait behind it. Extras are appended on settle instead. */
    if (this.admissionOpen() && item.status === "completed" && ["command", "file-change"].includes(item.kind)) {
      const locations = metadata?.locations ?? [];
      if (item.kind === "file-change") this.append(async () => {
        if (this.admissionOpen()) await this.discover(await this.discovery.locate(locations));
      });
      else if (!this.scanQueued) {
        this.scanQueued = true;
        this.append(async () => {
          this.scanQueued = false;
          if (this.admissionOpen()) await this.discover(await this.discovery.scan(locations));
        });
      }
    }
    {
      for (const url of claudeArtifactUrls(item.detail ?? "")) {
        const identity = url.split("/").at(-1)!;
        const previous = this.extras.get("claude:" + identity);
        if (!previous && !this.admissionOpen()) continue;
        if (!previous && this.count >= ARTIFACT_LIMIT) break;
        if (!previous) this.count++;
        this.extras.set("claude:" + identity, { v: 1, id: previous?.id ?? randomUUID(), kind: "claude-artifact", title: metadata?.title?.slice(0, 250) || identity, url });
      }
    }
    return item;
  }
  private append(work: () => Promise<void>) { this.pending = this.pending.then(() => work().catch(() => {})); }
  private admissionOpen() { return !this.cancellation.signal.aborted && (this.input.admissionOpen?.() ?? true); }
  private async discover(paths: string[]) {
    for (const path of paths) {
      if (!this.admissionOpen()) break;
      if (this.count >= ARTIFACT_LIMIT) break;
      const absolute = resolve(this.input.roots.workspace, path), stamp = await this.stamp(absolute);
      const explicit = [...this.items.values()].some(state => [...state.snapshots].some(([identity, fence]) => JSON.parse(identity)[0] === absolute && !fence.rejected && this.fileVersions.get(fence.id) === stamp));
      if (explicit) continue;
      const task = this.capture({ path }).then(async fence => ({ stamp: stamp === await this.stamp(absolute) ? stamp : "", fence }));
      this.automaticFlights.set(absolute, task);
      const captured = await task, { fence } = captured;
      this.automaticFlights.delete(absolute);
      if (this.cancellation.signal.aborted || !(this.input.admissionOpen?.() ?? true)) { await this.input.release(fence.id); break; }
      this.automatic.set(absolute, captured); if (!this.adopted.has(fence.id)) this.extras.set(fence.id, fence);
    }
  }
  async remove(itemId: string) {
    const state = this.items.get(itemId);
    this.items.delete(itemId);
    if (this.lastMessage === itemId) this.lastMessage = [...this.items.keys()].at(-1) ?? null;
    for (const fence of state?.snapshots.values() ?? []) await this.input.release(fence.id);
  }
  async settle(interrupted: boolean): Promise<ArtifactProjectionEvent[]> {
    if (this.settled) return [];
    this.settled = true;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const work = (async () => {
    await this.pending;
    if (this.cancellation.signal.aborted) return [];
    const events: ArtifactProjectionEvent[] = [];
    for (const [itemId, state] of this.items) {
      if (state.completed) continue;
      const published = await this.project(itemId, interrupted ? "interrupted" : "complete");
      if (this.cancellation.signal.aborted) return events;
      state.published = published; state.completed = true;
      events.push({ type: "item", item: { itemId, kind: "agent-message", title: "Replied", text: state.published, status: "completed" } });
    }
    if (this.extras.size) {
      const itemId = this.lastMessage ?? this.input.requestId + "-artifacts", state = this.state(itemId);
      state.published += (state.published ? "\n\n" : "") + [...this.extras.values()].map(encodeArtifactFence).join("\n\n");
      events.push({ type: "item", item: { itemId, kind: "agent-message", title: "Replied", text: state.published, status: "completed" } });
    }
    return events;
    })();
    const expired = new Promise<ArtifactProjectionEvent[]>(resolve => {
      deadline = setTimeout(() => {
        this.cancellation.abort(new Error("Artifact settlement deadline exceeded"));
        const events: ArtifactProjectionEvent[] = [];
        for (const [itemId, state] of this.items) {
          if (state.completed) continue;
          const text = state.published || segmentArtifactText(state.raw, "interrupted").map(segment => segment.type === "text" ? segment.text :
            encodeArtifactFence({ v: 1, id: randomUUID(), kind: "file", title: segment.type === "reference" ? segment.reference.title || "Artifact" : "Artifact", rejected: "interrupted" })).join("");
          state.published = text; state.completed = true;
          events.push({ type: "item", item: { itemId, kind: "agent-message", title: "Replied", text, status: "completed" } });
        }
        resolve(events);
      }, 5_000);
    });
    try { return await Promise.race([work, expired]); }
    finally { clearTimeout(deadline); this.cancellation.abort(new Error("Artifact settlement closed")); }
  }
}
