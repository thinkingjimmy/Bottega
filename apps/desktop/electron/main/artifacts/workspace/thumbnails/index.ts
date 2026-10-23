/**
 * [INPUT]: Authorized immutable identities, generation-scoped consumers, bounded cancellation and sandboxed capture.
 * [OUTPUT]: One active/two removable pending captures, shared consumer-safe cancellation, bounded ownership facts and static JPEG references.
 * [POS]: Thumbnail execution owner; waiting jobs retain identities, never complete snapshots.
 */
import { createHash } from "node:crypto";
import { nativeImage } from "electron";
import { artifactGeneration } from "../../admission/state";
import { artifactRuntime } from "../../core/runtime";
import { artifactFenceSchema } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { prepareDesignSnapshot } from "../../../design/documents/rendering";
import { captureDesignCanvas } from "../../../design/tooling/render-check";
import { designDigest } from "../../../design/documents/model";
import type { ArtifactWorkspace } from "../service";
import { thumbnailCancelled, thumbnailRequestFacts, withThumbnailRequest } from "./lifetime";
export { cancelThumbnailRequest, cancelThumbnailWindow, withThumbnailRequest } from "./lifetime";
// Replace persistent image identities only when rendering or preview resolution changes.
const THUMBNAIL_RENDER_VERSION = 4;
type Flight = { key: string; generation: string; controller: AbortController; consumers: Set<AbortSignal>; done: boolean; run(signal: AbortSignal): Promise<void>; promise: Promise<void>; resolve(): void; reject(cause: unknown): void };
const flights = new Map<string, Flight>(), pending: Flight[] = [];
let running: Flight | undefined, activeBytes = 0, capturePixels = 0;
const released = { queued: 0, active: 0, expired: 0 };
export const thumbnailFacts = () => ({ active: Number(Boolean(running)), pending: pending.length, activeBytes, capturePixels, consumers: [...flights.values()].reduce((sum, flight) => sum + flight.consumers.size, 0), ...thumbnailRequestFacts(), released: { ...released } });
function cancel(flight: Flight) {
  if (flight.done || flight.controller.signal.aborted) return;
  flight.controller.abort(thumbnailCancelled());
  const index = pending.indexOf(flight);
  if (index >= 0) { pending.splice(index, 1); flight.done = true; flight.reject(thumbnailCancelled()); released.queued++; }
  else released.active++;
  if (flights.get(flight.key) === flight) flights.delete(flight.key);
}
function drain() {
  if (running) return;
  const flight = pending.shift(); if (!flight) return; running = flight;
  void flight.run(flight.controller.signal).then(() => { flight.done = true; flight.resolve(); }, cause => { flight.done = true; flight.reject(cause); }).finally(() => {
    activeBytes = capturePixels = 0; running = undefined;
    if (flights.get(flight.key) === flight) flights.delete(flight.key);
    drain();
  });
}
async function join(flight: Flight, signal: AbortSignal) {
  signal.throwIfAborted(); flight.consumers.add(signal);
  let abort!: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => { flight.consumers.delete(signal); if (!flight.consumers.size) cancel(flight); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
  });
  try { drain(); await Promise.race([flight.promise, interrupted]); signal.throwIfAborted(); }
  finally { signal.removeEventListener("abort", abort); flight.consumers.delete(signal); if (!flight.consumers.size && !flight.done) cancel(flight); }
}
export async function designThumbnail(input: WorkspaceCommand, workspace: ArtifactWorkspace, signal: AbortSignal = new AbortController().signal) {
  const { summary } = await workspace.identity(input), artifacts = artifactRuntime()!, boardId = input.boardId ?? summary.launchBoard;
  signal.throwIfAborted(); const generation = artifactGeneration();
  for (const flight of flights.values()) if (flight.generation !== generation) { released.expired++; cancel(flight); }
  const board = summary.boards.find(board => board.id === boardId); if (!board) throw new Error("Artifact board is unavailable");
  const id = "thumb_" + createHash("sha256").update(JSON.stringify([THUMBNAIL_RENDER_VERSION, input.chatId, input.incarnationId, input.artifactId, summary.snapshotRef, boardId])).digest("hex"), key = JSON.stringify([generation, id]);
  const ref = { chatId: input.chatId, incarnationId: input.incarnationId, artifactId: id };
  if (!artifacts.custody.lookup(ref)) {
    let flight = flights.get(key);
    if (!flight) {
      if (pending.length + Number(Boolean(running)) >= 3) throw new Error("artifact-thumbnail-busy");
      let resolve!: () => void, reject!: (cause: unknown) => void;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); void promise.catch(() => {});
      flight = { key, generation, controller: new AbortController(), consumers: new Set(), done: false, promise, resolve, reject, run: async signal => {
        signal.throwIfAborted();
        const snapshot = await workspace.version(input); signal.throwIfAborted();
        if (artifactGeneration() !== generation || snapshot.version.snapshotRef !== summary.snapshotRef) throw new Error("artifact-thumbnail-expired");
        const stores = new Set(snapshot.files.map(file => file.data.buffer)); activeBytes = [...stores].reduce((sum, store) => sum + store.byteLength, 0);
        const prepared = await prepareDesignSnapshot(snapshot, boardId); signal.throwIfAborted();
        if (!stores.has(prepared.html.buffer)) activeBytes += prepared.html.buffer.byteLength; capturePixels = prepared.size.width * prepared.size.height;
        const captured = await captureDesignCanvas({ html: prepared.html, viewport: "desktop", size: prepared.size, hideScrollbars: true, maxImageBytes: 192 * 1024, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) }); signal.throwIfAborted();
        const image = nativeImage.createFromBuffer(Buffer.from(captured.data, "base64")), size = image.getSize(); let bytes: Buffer = Buffer.alloc(0);
        for (const width of [960, 640, 320]) { const ratio = Math.min(1, width / size.width, width * .75 / size.height); bytes = image.resize({ width: Math.max(1, Math.round(size.width * ratio)), height: Math.max(1, Math.round(size.height * ratio)) }).toJPEG(82); if (bytes.length <= 96 * 1024) break; }
        if (bytes.length > 96 * 1024) throw new Error("artifact-thumbnail-budget");
        const fence = artifactFenceSchema.parse({ v: 1, id, kind: "image", title: `${board.title.slice(0, 100)}-v${snapshot.version.revision}.jpg`, mime: "image/jpeg", bytes: bytes.length, sha256: designDigest(bytes).slice(7), createdAt: Date.now() });
        await workspace.identity(input); signal.throwIfAborted();
        if (artifactGeneration() !== generation) throw new Error("artifact-thumbnail-expired");
        await artifacts.retainExport({ ...ref, artifactId: input.artifactId! }, fence, bytes); signal.throwIfAborted();
      } };
      flights.set(key, flight); pending.push(flight);
    }
    await join(flight, signal);
  }
  signal.throwIfAborted(); const result = await artifacts.resolve(ref); await workspace.identity(input); signal.throwIfAborted();
  return { fence: result.record.fence, filename: result.record.fence.title, data: result.data.toString("base64"), mime: "image/jpeg", revision: summary.revision, snapshotRef: summary.snapshotRef, readSetDigest: summary.readSetDigest, published: false };
}
export async function transferDesignThumbnail(input: WorkspaceCommand, workspace: ArtifactWorkspace) {
  return withThumbnailRequest(input, 0, async signal => {
    const { data: _data, mime: _mime, ...result } = await designThumbnail(input, workspace, signal), artifacts = artifactRuntime()!; signal.throwIfAborted();
    const published = await artifacts.publisher.flushRef({ chatId: input.chatId, incarnationId: input.incarnationId, artifactId: result.fence.id }); await workspace.identity(input); signal.throwIfAborted(); return { ...result, published };
  });
}
