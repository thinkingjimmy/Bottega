/**
 * [INPUT]: Private backend text/tool events, immutable snapshot admission and exact turn identity.
 * [OUTPUT]: Ordered path-free deltas/items with stable reference IDs through completion and interruption.
 * [POS]: Artifact projection before the canonical turn reducer and every renderer/cloud subscriber.
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { ARTIFACT_LIMIT, ARTIFACT_MARKERS, artifactTailState, encodeArtifactFence, segmentArtifactText, type ArtifactFence, type ArtifactReference, type ArtifactRejection } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { AgentTurnItem } from "../../../shared/agent-ipc";
import type { ArtifactRoots } from "./admission";
import { ArtifactFileDiscovery, claudeArtifactUrls, type ArtifactToolMetadata } from "./discovery/files";
type ItemState = { raw: string; published: string; completed: boolean; snapshots: Map<string, ArtifactFence> };
export type ArtifactProjectionEvent = { type: "item-delta"; itemId: string; text: string } | { type: "item"; item: AgentTurnItem };
export class ArtifactProjection {
  private readonly items = new Map<string, ItemState>();
  private readonly discovery: ArtifactFileDiscovery;
  private readonly extras = new Map<string, ArtifactFence>();
  private lastMessage: string | null = null;
  private count = 0;
  private settled = false;
  private pending: Promise<void> = Promise.resolve();
  private scanQueued = false;
  constructor(private readonly input: { roots: ArtifactRoots; requestId: string;
    snapshot(reference: ArtifactReference, id: string): Promise<ArtifactFence>;
    release(id: string): Promise<void> }) { this.discovery = new ArtifactFileDiscovery(input.roots); }
  private state(itemId: string) {
    let value = this.items.get(itemId);
    if (!value) { value = { raw: "", published: "", completed: false, snapshots: new Map() }; this.items.set(itemId, value); }
    return value;
  }
  private async capture(reference: ArtifactReference): Promise<ArtifactFence> {
    const id = randomUUID();
    if (++this.count > ARTIFACT_LIMIT) return { v: 1, id, kind: "html-fragment", title: "Visualization", rejected: "budget" };
    try { return await this.input.snapshot(reference, id); }
    catch (cause) {
      const reason = cause instanceof Error ? cause.message : "unsupported";
      const rejected: ArtifactRejection = ["path-denied", "too-large", "not-utf8", "symlink", "budget", "unsupported"].includes(reason) ? reason as ArtifactRejection : "path-denied";
      return { v: 1, id, kind: "html-fragment", title: "Visualization", rejected };
    }
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
      const path = segment.type === "reference" ? resolve(this.input.roots.workspace, segment.reference.path) : `rejected:${result.length}`;
      const occurrence = occurrences.get(path) ?? 0; occurrences.set(path, occurrence + 1);
      const identity = JSON.stringify([path, occurrence]);
      let fence = state.snapshots.get(identity);
      if (!fence) {
        fence = segment.type === "reference" ? await this.capture(segment.reference) :
          { v: 1, id: randomUUID(), kind: "html-fragment", title: "Visualization", rejected: segment.reason };
        state.snapshots.set(identity, fence);
      }
      result.push(encodeArtifactFence(fence));
    }
    return result.join("");
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
    if (item.kind === "agent-message") {
      const state = this.state(item.itemId); state.raw = item.text ?? state.raw;
      state.completed = item.status !== "running"; this.lastMessage = item.itemId;
      state.published = await this.project(item.itemId, item.status === "failed" ? "interrupted" : state.completed ? "complete" : "stream");
      return { ...item, text: state.published };
    }
    if (item.kind === "command") this.discovery.declare(metadata?.title ?? item.title);
    /* Discovery walks repositories; the projection lane is serial, so every later delta
       would wait behind it. Extras are appended on settle instead. */
    if (item.status === "completed" && ["command", "file-change"].includes(item.kind)) {
      const locations = metadata?.locations ?? [];
      if (item.kind === "file-change") this.append(async () => this.discover(await this.discovery.locate(locations)));
      else if (!this.scanQueued) {
        this.scanQueued = true;
        this.append(async () => { this.scanQueued = false; await this.discover(await this.discovery.scan(locations)); });
      }
    }
    {
      for (const url of claudeArtifactUrls(item.detail ?? "")) {
        const identity = url.split("/").at(-1)!;
        const previous = this.extras.get("claude:" + identity);
        if (!previous && this.count >= ARTIFACT_LIMIT) break;
        if (!previous) this.count++;
        this.extras.set("claude:" + identity, { v: 1, id: previous?.id ?? randomUUID(), kind: "claude-artifact", title: metadata?.title?.slice(0, 250) || identity, url });
      }
    }
    return item;
  }
  private append(work: () => Promise<void>) { this.pending = this.pending.then(() => work().catch(() => {})); }
  private async discover(paths: string[]) {
    for (const path of paths) {
      if (this.count >= ARTIFACT_LIMIT) break;
      const fence = await this.capture({ path }); this.extras.set(fence.id, fence);
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
    await this.pending;
    const events: ArtifactProjectionEvent[] = [];
    for (const [itemId, state] of this.items) {
      if (state.completed) continue;
      state.published = await this.project(itemId, interrupted ? "interrupted" : "complete"); state.completed = true;
      events.push({ type: "item", item: { itemId, kind: "agent-message", title: "Replied", text: state.published, status: "completed" } });
    }
    if (this.extras.size) {
      const itemId = this.lastMessage ?? this.input.requestId + "-artifacts", state = this.state(itemId);
      state.published += (state.published ? "\n\n" : "") + [...this.extras.values()].map(encodeArtifactFence).join("\n\n");
      events.push({ type: "item", item: { itemId, kind: "agent-message", title: "Replied", text: state.published, status: "completed" } });
    }
    return events;
  }
}
