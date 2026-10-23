/**
 * [INPUT]: Abortable immutable owner-bound image readers, validated source dimensions, readback-optimized Canvas2D encoding, display-size demands and gesture activity.
 * [OUTPUT]: Shared Blob previews, bounded immutable dimension metadata, display-sized serial image decoding and byte/pixel ownership with budget-reserved offscreen and gesture-deferred quality replacement.
 * [POS]: Canvas preview resource owner; original saved bytes stay with the host/export service.
 */
import type { ArtifactHost } from "../../../context";
import { cameraTrace } from "../editor/stage/state/diagnostics";
export type PreviewDemand = { width: number; height: number; visible: boolean; moving: boolean };
type Consumer = PreviewDemand & { committed?: string; notify(url: string, failed: boolean): void };
type Version = { bytes: number; pixels: number };
type Entry = {
  key: string; load(signal: AbortSignal): Promise<Blob>; abort: AbortController; users: Map<object, Consumer>; versions: Map<string, Version>;
  blob?: Blob; url: string; width: number; height: number; targetWidth: number; targetHeight: number;
  limitWidth: number; limitHeight: number; maxBytes: number; sourceWidth: number; sourceHeight: number;
  queued: boolean; loading: boolean; failed: boolean; low: boolean; epoch: number;
};
const MiB = 1024 * 1024;
const pools = new WeakMap<ArtifactHost, { thumbnail: PreviewPool; image: PreviewPool }>();
export function previewPool(host: ArtifactHost, kind: "thumbnail" | "image") {
  let value = pools.get(host);
  if (!value) { value = { thumbnail: new PreviewPool(host.scope, "thumbnail", 24 * MiB, 4 * MiB), image: new PreviewPool(host.scope, "image", 64 * MiB, 16 * MiB) }; pools.set(host, value); }
  return value[kind];
}
export class PreviewPool {
  private entries = new Map<string, Entry>();
  private sourceDimensions = new Map<string, { width: number; height: number }>();
  private queue: Entry[] = [];
  private running = false;
  private activePixels = 0;
  private activeEncodedBytes = 0;
  private activeSourceBytes = 0;
  private released = { consumer: 0, replaced: 0, sourceBudget: 0, late: 0 };
  constructor(private readonly owner: string, private readonly kind: "thumbnail" | "image", private readonly pixelBudget: number, private readonly encodedBudget: number) {}
  facts() {
    const entries = [...this.entries.values()], versions = entries.flatMap(entry => [...entry.versions.values()]);
    return { entries: entries.length, refs: entries.reduce((sum, entry) => sum + entry.users.size, 0), urls: versions.length,
      bytes: versions.reduce((sum, version) => sum + version.bytes, 0) + entries.reduce((sum, entry) => sum + (entry.blob?.size ?? 0), 0),
      decodedBytes: versions.reduce((sum, version) => sum + version.pixels * 4, 0), activePixels: this.activePixels, activeEncodedBytes: this.activeEncodedBytes, activeSourceBytes: this.activeSourceBytes, dimensionEntries: this.sourceDimensions.size,
      active: Number(this.running), pending: this.queue.length, released: { ...this.released } };
  }
  private observe() { if ((globalThis as typeof globalThis & { __canvasDiagnostics?: boolean }).__canvasDiagnostics) cameraTrace("preview-resources", { owner: this.owner, kind: this.kind, ...this.facts() }); }
  acquire(key: string, load: (signal: AbortSignal) => Promise<Blob>, demand: PreviewDemand, notify: Consumer["notify"]) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, load, abort: new AbortController(), users: new Map(), versions: new Map(), url: "", width: 0, height: 0, targetWidth: 0, targetHeight: 0, limitWidth: 0, limitHeight: 0,
        maxBytes: this.encodedBudget / 4, sourceWidth: 0, sourceHeight: 0, queued: false, loading: false, failed: false, low: true, epoch: 0 };
      this.entries.set(key, entry);
    }
    const held = entry, token = {}, user: Consumer = { ...demand, notify }; held.users.set(token, user);
    notify(held.url, held.failed); this.rebalance(); this.observe();
    return {
      update: (next: PreviewDemand) => { Object.assign(user, next); this.rebalance(); },
      motion: (active: boolean) => { if (user.moving === active) return; user.moving = active; if (!active) this.rebalance(); },
      commit: (url: string) => { user.committed = url; this.prune(held); },
      retry: () => { held.failed = false; held.low = true; held.blob = undefined; held.limitWidth = held.limitHeight = 0; this.enqueue(held); },
      fail: (url: string) => { if (held.url !== url || !held.users.has(token)) return; held.failed = true; for (const user of held.users.values()) user.notify(held.url, true); },
      release: () => {
        if (!held.users.delete(token)) return;
        if (!held.users.size) {
          held.epoch++; held.abort.abort(); this.entries.delete(key); this.queue = this.queue.filter(entry => entry !== held);
          for (const url of held.versions.keys()) { URL.revokeObjectURL(url); this.released.consumer++; }
          held.versions.clear(); held.blob = undefined; held.url = "";
        }
        this.prune(held); this.rebalance(); this.observe();
      },
    };
  }
  private prune(entry: Entry) {
    const referenced = new Set([entry.url, ...[...entry.users.values()].map(user => user.committed)]);
    for (const url of entry.versions.keys()) if (!referenced.has(url)) { URL.revokeObjectURL(url); entry.versions.delete(url); this.released.replaced++; }
  }
  private visible(entry: Entry) { return [...entry.users.values()].some(user => user.visible); }
  private rebalance() {
    const entries = [...this.entries.values()], visible = entries.filter(entry => this.visible(entry)), headroom = this.previewHeadroom();
    const weight = Math.max(1, visible.length + (entries.length - visible.length) * .05 || entries.length);
    // A quarter of the decoded soft budget leaves room for original decode, Canvas and URL replacement.
    const pixels = this.pixelBudget / 16 / weight;
    for (const entry of entries) {
      const users = [...entry.users.values()], width = Math.max(1, ...users.map(user => user.width)), height = Math.max(1, ...users.map(user => user.height));
      const priority = this.visible(entry) || !visible.length ? 1 : .05;
      const maxBytes = Math.max(1024, Math.min(this.encodedBudget / 4, this.encodedBudget / 2 / weight * priority));
      if (maxBytes > entry.maxBytes) entry.limitWidth = entry.limitHeight = 0;
      entry.maxBytes = maxBytes;
      const fit = entry.sourceWidth ? Math.min(1, width / entry.sourceWidth, height / entry.sourceHeight) : 1;
      const desiredWidth = entry.sourceWidth ? entry.sourceWidth * fit : width, desiredHeight = entry.sourceHeight ? entry.sourceHeight * fit : height;
      const ratio = Math.min(1, Math.sqrt(pixels * priority / (desiredWidth * desiredHeight)), this.kind === "thumbnail" ? 960 / desiredWidth : 8000 / desiredWidth, this.kind === "thumbnail" ? 720 / desiredHeight : 8000 / desiredHeight,
        entry.limitWidth ? entry.limitWidth / desiredWidth : 1, entry.limitHeight ? entry.limitHeight / desiredHeight : 1);
      entry.targetWidth = Math.max(1, Math.floor(desiredWidth * ratio)); entry.targetHeight = Math.max(1, Math.floor(desiredHeight * ratio));
      if (!entry.failed && this.needsOutput(entry)) this.enqueue(entry, headroom);
    }
  }
  private previewHeadroom() { const facts = this.facts(); return facts.decodedBytes <= this.pixelBudget / 4 && facts.bytes <= this.encodedBudget / 2; }
  private deferOffscreen(entry: Entry, headroom?: boolean) { return Boolean(entry.url) && !entry.low && !this.visible(entry) && (headroom ?? this.previewHeadroom()); }
  private deferUpgrade(entry: Entry, width = entry.targetWidth, height = entry.targetHeight) { return Boolean(entry.url) && !entry.low && width >= entry.width && height >= entry.height && [...entry.users.values()].some(user => user.moving); }
  private needsOutput(entry: Entry) {
    if (!entry.url) return true;
    const target = this.outputSize(entry, false);
    return Math.abs(target.width - entry.width) > 16 || Math.abs(target.height - entry.height) > 16;
  }
  private outputSize(entry: Entry, lowQuality = entry.low) {
    const low = lowQuality ? Math.min(1, 128 / Math.max(entry.targetWidth, entry.targetHeight)) : 1;
    const ratio = Math.min(1, entry.targetWidth * low / entry.sourceWidth, entry.targetHeight * low / entry.sourceHeight);
    return { width: Math.max(1, Math.round(entry.sourceWidth * ratio)), height: Math.max(1, Math.round(entry.sourceHeight * ratio)) };
  }
  private enqueue(entry: Entry, headroom?: boolean) { if (!entry.users.size || entry.queued || entry.loading || this.deferUpgrade(entry) || this.deferOffscreen(entry, headroom)) return; entry.queued = true; this.queue.push(entry); void this.drain(); }
  private async drain() {
    if (this.running) return; this.running = true;
    try {
      while (this.queue.length) {
        this.queue.sort((a, b) => Number(this.visible(b)) - Number(this.visible(a)) || Number(b.low) - Number(a.low));
        const entry = this.queue.shift()!; entry.queued = false; if (!entry.users.size || this.deferUpgrade(entry) || this.deferOffscreen(entry)) continue;
        entry.loading = true; const epoch = entry.epoch;
        try {
          // Retired URL generations also own pixels; reserve decode headroom before allocating another bitmap.
          while (entry.users.size && entry.epoch === epoch && this.facts().decodedBytes > this.pixelBudget / 2) await new Promise(resolve => setTimeout(resolve, 16));
          if (!entry.users.size || entry.epoch !== epoch) continue;
          const blob = entry.blob ?? await entry.load(entry.abort.signal);
          if (!entry.users.size || entry.epoch !== epoch) { this.released.late++; continue; }
          this.activeSourceBytes = blob.size;
          const known = this.kind === "image" ? this.sourceDimensions.get(entry.key) : undefined;
          if (known) {
            entry.sourceWidth = known.width; entry.sourceHeight = known.height;
            this.sourceDimensions.delete(entry.key); this.sourceDimensions.set(entry.key, known);
            this.rebalance();
          }
          const requested = known ? this.outputSize(entry) : undefined;
          const image = await createImageBitmap(blob, requested ? { resizeWidth: requested.width, resizeHeight: requested.height, resizeQuality: "high" } : undefined);
          let output: Blob | null = null, width = 0, height = 0;
          try {
            if (!entry.users.size || entry.epoch !== epoch) { this.released.late++; continue; }
            if (this.deferOffscreen(entry)) continue;
            const source = known ?? { width: image.width, height: image.height };
            if (!source.width || !source.height || source.width > 8000 || source.height > 8000 || source.width * source.height > 16_000_000) throw new Error("Preview dimensions exceed the saved image budget");
            if (requested && (image.width !== requested.width || image.height !== requested.height)) throw new Error("Preview decoder returned unexpected dimensions");
            if (this.kind === "image" && !known) {
              this.sourceDimensions.set(entry.key, source);
              while (this.sourceDimensions.size > 128) this.sourceDimensions.delete(this.sourceDimensions.keys().next().value!);
            }
            entry.sourceWidth = source.width; entry.sourceHeight = source.height; this.activePixels = image.width * image.height;
            this.rebalance(); this.observe();
            const target = this.outputSize(entry), scale = Math.min(1, image.width / target.width, image.height / target.height);
            width = Math.max(1, Math.round(target.width * scale)); height = Math.max(1, Math.round(target.height * scale));
            const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
            this.activePixels += width * height; this.observe();
            try { const context = canvas.getContext("2d", { willReadFrequently: true }); if (!context) throw new Error("Preview canvas is unavailable"); context.drawImage(image, 0, 0, width, height); output = await new Promise(resolve => canvas.toBlob(resolve, this.kind === "thumbnail" ? "image/jpeg" : "image/png", .8)); }
            finally { canvas.width = canvas.height = 0; }
          } finally { image.close(); this.activePixels = 0; }
          if (!output) throw new Error("Preview encoding failed");
          if (!entry.users.size || entry.epoch !== epoch) { this.released.late++; continue; }
          if (output.size > entry.maxBytes) {
            const ratio = Math.min(.75, Math.sqrt(entry.maxBytes / output.size) * .9);
            entry.limitWidth = Math.max(1, Math.floor(width * ratio)); entry.limitHeight = Math.max(1, Math.floor(height * ratio)); entry.low = false; this.rebalance(); continue;
          }
          const sourceBytes = [...this.entries.values()].reduce((sum, value) => sum + (value.blob?.size ?? 0), 0);
          if (!entry.blob && sourceBytes + blob.size <= this.encodedBudget / 4) entry.blob = blob;
          this.activeEncodedBytes = output.size;
          if (this.facts().bytes + output.size > this.encodedBudget) for (const value of this.entries.values()) if (value.blob) { value.blob = undefined; this.released.sourceBudget++; }
          // Existing users acknowledge retired URLs on commit. Waiting here keeps one active Blob and never starts another decode.
          while (entry.users.size && entry.epoch === epoch && (this.facts().bytes + output.size > this.encodedBudget || this.facts().decodedBytes + width * height * 4 > this.pixelBudget)) await new Promise(resolve => setTimeout(resolve, 16));
          if (!entry.users.size || entry.epoch !== epoch) { this.released.late++; continue; }
          if (this.deferUpgrade(entry, width, height) || this.deferOffscreen(entry)) continue;
          const url = URL.createObjectURL(output); entry.versions.set(url, { bytes: output.size, pixels: width * height });
          entry.url = url; entry.width = width; entry.height = height; entry.failed = false; entry.low = false;
          for (const user of entry.users.values()) user.notify(url, false);
          this.prune(entry); this.observe();
        } catch (cause) {
          if (!entry.users.size) continue;
          if (cause instanceof Error && cause.message === "artifact-thumbnail-busy") { await new Promise(resolve => setTimeout(resolve, 250)); continue; }
          entry.failed = true; for (const user of entry.users.values()) user.notify(entry.url, true);
        } finally {
          this.activeSourceBytes = this.activeEncodedBytes = 0; entry.loading = false;
          if (entry.users.size && !entry.failed && this.needsOutput(entry)) this.enqueue(entry);
        }
      }
    } finally { this.running = false; this.activePixels = this.activeSourceBytes = this.activeEncodedBytes = 0; this.observe(); }
  }
}
