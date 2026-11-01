/**
 * [INPUT]: Exact native session snapshot, complete closed choices, live consumer guards/signals and independent read-only job leases and existing Artifact custody.
 * [OUTPUT]: Main-frozen original jobs, concrete confirmed prepared bytes, bounded shared-consumer work/spec cache and exact private file receipts.
 * [POS]: Original native export authority; arbitrary renderer output and unconfirmed font fallbacks cannot enter custody.
 */
import { z } from "zod";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { nativeExportOptionsSchema } from "@ai-chat/cloud-protocol/artifacts/design/export/options";
import { artifactFenceSchema } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { artifactRuntime } from "../../../artifacts/core/runtime";
import { designDigest } from "../../documents/model";
import { createNativeExportPlan, type NativeExportSnapshot } from "./plan";
import { produceNativeExport } from "./renderer";
export const nativeExportJobSchema = z.object({ options: nativeExportOptionsSchema, files: z.array(z.string().min(1).max(240)).min(1).max(256).optional() }).strict();
type Consumer = { guard(): void; signal: AbortSignal };
type Flight = { task: Promise<void>; controller: AbortController; consumers: Set<Consumer> };
const flights = new Map<string, Flight>();
let nextJobWindow = Number.MIN_SAFE_INTEGER;
function join(flight: Flight, consumer: Consumer) {
  consumer.signal.throwIfAborted(); consumer.guard();
  if (flight.consumers.size >= 16) throw new Error("This native export already has sixteen consumers");
  flight.consumers.add(consumer);
  const leave = () => {
    flight.consumers.delete(consumer); consumer.signal.removeEventListener("abort", leave);
    if (!flight.consumers.size) flight.controller.abort(new Error("The last native export consumer closed"));
  };
  consumer.signal.addEventListener("abort", leave, { once: true });
  return leave;
}
function live(flight: Flight) {
  flight.controller.signal.throwIfAborted();
  for (const consumer of flight.consumers) {
    if (consumer.signal.aborted) continue;
    try { consumer.guard(); return; } catch { /* Another current consumer may still own the same frozen job. */ }
  }
  flight.controller.abort(new Error("The native export has no current consumer")); flight.controller.signal.throwIfAborted();
}
async function wait(flight: Flight, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason); signal.addEventListener("abort", abort, { once: true });
    flight.task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}
export async function planNativeExportJob(input: WorkspaceCommand, snapshot: NativeExportSnapshot, raw: unknown) {
  const request = nativeExportJobSchema.parse(raw);
  if (request.files) {
    if (request.options.pages || new Set(request.files).size !== request.files.length) throw new Error("Choose one exact native export range");
    request.options.pages = request.files.map(path => {
      const board = snapshot.version.manifest.boards.find(board => board.file === path.replace(/^project\//, ""));
      if (!board) throw new Error("A native export file is outside this exact source"); return board.id;
    });
  }
  return { request, plan: await createNativeExportPlan(input, snapshot, request.options) };
}
export type PreparedNativeExport = { plan: Awaited<ReturnType<typeof createNativeExportPlan>>; result: Awaited<ReturnType<typeof produceNativeExport>> };
export async function retainNativeExportJob(input: WorkspaceCommand, snapshot: NativeExportSnapshot, raw: unknown, _windowId: number, guard: () => void, prepared?: PreparedNativeExport, signal: AbortSignal = new AbortController().signal) {
  signal.throwIfAborted(); guard(); const { plan } = await planNativeExportJob(input, snapshot, raw); guard();
  if (prepared && (prepared.plan.digest !== plan.digest || prepared.result.exportSpecDigest !== plan.digest)) throw new Error("The confirmed native preview choices changed");
  if (plan.spec.options.fonts.mode !== "strict" && !prepared) throw new Error("Preview and confirm this exact font fallback before downloading");
  if (plan.spec.options.format === "html" && !plan.spec.options.interactive) throw new Error("Original native HTML preserves interactions; static HTML is not available");
  if (plan.spec.options.format === "pptx" && !prepared) throw new Error("This editable PPTX producer does not embed fonts. Preview the basic-font or picture variant before downloading");
  const artifacts = artifactRuntime()!, id = "export_" + designDigest(JSON.stringify(["native-main-job/v2", input.chatId, input.incarnationId, plan.digest])).slice(7);
  const parent = { chatId: input.chatId, incarnationId: input.incarnationId, artifactId: input.artifactId! }, ref = { ...parent, artifactId: id };
  if (!artifacts.custody.lookup(ref)) {
    let flight = flights.get(id);
    if (flight?.controller.signal.aborted) { flights.delete(id); flight = undefined; }
    if (!flight) {
      if (flights.size >= 2) throw new Error("Two native export jobs are running. Try again after one completes");
      const current: Flight = { task: Promise.resolve(), controller: new AbortController(), consumers: new Set() };
      const jobWindow = nextJobWindow++;
      if (jobWindow >= Number.MIN_SAFE_INTEGER + 0x100000000) throw new Error("Reopen the app before starting more native exports");
      current.task = Promise.resolve().then(async () => {
        live(current);
        const result = prepared?.result ?? await produceNativeExport(input, snapshot, plan, jobWindow, AbortSignal.any([current.controller.signal, AbortSignal.timeout(60_000)]), () => live(current)); live(current);
        if (!result.fontProof.length || result.fontProof.some(proof => !proof || typeof proof !== "object" || !("status" in proof) || !(proof.status === "verified" || prepared && ["basic", "raster"].includes(plan.spec.options.fonts.mode) && proof.status === "requires-confirmed-preview"))) throw new Error("The exact native output fonts were not verified");
        const mime = ({ png: "image/png", pdf: "application/pdf", html: "text/html", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" } as const)[plan.spec.options.format];
        const safeName = result.filename.replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").trim();
        if (!safeName || Buffer.byteLength(safeName) > 240) throw new Error("The original export filename exceeds its byte budget");
        const fence = artifactFenceSchema.parse({ v: 1, id, kind: "file", title: safeName, mime: plan.spec.options.bundle ? "application/zip" : mime,
          bytes: result.bytes.length, sha256: result.digest.slice(7), createdAt: Date.now() });
        await artifacts.retainExport(parent, fence, result.bytes); live(current);
      }).finally(() => { if (flights.get(id) === current) flights.delete(id); });
      flight = current; flights.set(id, current);
    }
    const leave = join(flight, { guard, signal });
    try { await wait(flight, signal); } finally { leave(); }
  }
  signal.throwIfAborted(); guard(); const result = await artifacts.metadata(ref), published = await artifacts.publisher.flushRef(ref); signal.throwIfAborted(); guard();
  return { fence: result.fence, filename: result.fence.title, published, revision: snapshot.version.revision, snapshotRef: snapshot.version.snapshotRef,
    readSetDigest: snapshot.version.readSetDigest, exportSpec: plan.spec, exportSpecDigest: plan.digest };
}
