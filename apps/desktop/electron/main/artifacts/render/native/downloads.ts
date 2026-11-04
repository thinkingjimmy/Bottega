/**
 * [INPUT]: Exact native editor source/lease, closed original producer job requests and existing private Artifact custody.
 * [OUTPUT]: Main-frozen spec-keyed private exports and whole-folder fixed-cut jobs/progress/cancellation/retry, authenticated exact-file reads and concrete preview confirmation, deduplicated real save/cancel outcomes.
 * [POS]: Native delivery boundary; arbitrary generated renderer bytes cannot become a retained export.
 */
import { z } from "zod";
import { projectExportRequestSchema } from "@ai-chat/cloud-protocol/artifacts/design/export/project";
import type { ProjectExportJobs } from "../../../design/projects/jobs/export";
import { NativeExportPreviews, nativePreviewRequestSchema, cancelNativePreviewSchema } from "../../../design/native/exports/previews";
import type { IncomingMessage } from "node:http";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { artifactRuntime } from "../../core/runtime";
import { designDigest } from "../../../design/documents/model";
import { nativeExportJobSchema, retainNativeExportJob } from "../../../design/native/exports/jobs";
import type { NativeExportSnapshot } from "../../../design/native/exports/plan";
let saving = 0;
type Delivery = { fence: import("@ai-chat/cloud-protocol/turns/text/artifact-reference").ArtifactFence; filename: string; requestId: string };
type Preview = Awaited<ReturnType<NativeExportPreviews["prepare"]>>;
type Record = { identity: string; result: Promise<Delivery | Preview | { cancelled: boolean }>; save?: Promise<unknown> };
export class NativeDownloads {
  private readonly requests = new Map<string, Record>();
  private readonly lifetime = new AbortController();
  private readonly previews: NativeExportPreviews;
  private projects?: Promise<ProjectExportJobs>;
  constructor(private readonly input: WorkspaceCommand, private readonly guard: () => void, private readonly windowId: number) { this.previews = new NativeExportPreviews(input, windowId, guard); }
  close() { this.lifetime.abort(new Error("The native export consumer closed")); this.previews.close(); void this.projects?.then(value => value.close()).catch(() => {}); }
  async stage(request: IncomingMessage, id: string, snapshot: NativeExportSnapshot) {
    this.guard();
    if (request.headers["content-type"] !== "application/json") throw new Error("Native downloads require a main-owned producer job");
    if (this.requests.size >= 64 && !this.requests.has(id)) throw new Error("Native export delivery is busy");
    const parts: Buffer[] = []; let total = 0;
    for await (const piece of request) { const bytes = Buffer.from(piece); total += bytes.length; if (total > 16 * 1024) throw new Error("Native export choices exceed their byte budget"); parts.push(bytes); }
    const choices = z.union([nativeExportJobSchema, nativePreviewRequestSchema, cancelNativePreviewSchema, projectExportRequestSchema]).parse(JSON.parse(Buffer.concat(parts).toString("utf8")));
    if ("project" in choices) {
      this.lifetime.signal.throwIfAborted();
      this.projects ??= import("../../../design/projects/jobs/export").then(module => { this.lifetime.signal.throwIfAborted(); return new module.ProjectExportJobs(this.input, this.guard); });
      const result = (await this.projects).request(id, choices, snapshot);
      if (result.fence && result.project.state === "complete") this.requests.set(id, { identity: "project:" + result.fence.id, result: Promise.resolve(result as Delivery) });
      return result;
    }
    const identity = designDigest(JSON.stringify([snapshot.version.snapshotRef, this.input.candidateId, this.input.candidateDigest, choices]));
    const old = this.requests.get(id);
    if (old) { if (old.identity !== identity) throw new Error("Native export request choices or source changed"); const result = await old.result; if ("preview" in result) this.previews.assert(result.preview.id); return result; }
    const result = (async () => {
      if ("cancelPreview" in choices) return this.previews.cancel(choices.cancelPreview);
      if ("previewMode" in choices) return this.previews.prepare(choices, snapshot);
      const prepared = await this.previews.confirm(choices, snapshot);
      return { ...await retainNativeExportJob(this.input, snapshot, choices, this.windowId, this.guard, prepared, this.lifetime.signal), requestId: id };
    })();
    this.requests.set(id, { identity, result }); return result;
  }
  async read(id: string) {
    this.guard(); const preview = await this.previews.read(id); if (preview) return preview;
    const record = this.requests.get(id);
    if (!record) throw new Error("Native export delivery expired");
    const result = await record.result; this.guard(); if (!("fence" in result)) throw new Error("Confirm this exact export preview before downloading");
    const source = await artifactRuntime()!.resolve({ chatId: this.input.chatId, incarnationId: this.input.incarnationId, artifactId: result.fence.id });
    this.guard();
    if (designDigest(source.data) !== "sha256:" + result.fence.sha256 || source.data.length !== result.fence.bytes) throw new Error("Native retained export bytes changed");
    return { data: source.data, mime: result.fence.mime! };
  }
  async save(input: WorkspaceCommand, perform: (result: { data: string; filename: string; [key: string]: unknown }) => Promise<unknown>) {
    this.guard(); const record = this.requests.get("native-" + input.requestId);
    if (!record) throw new Error("Native export delivery expired");
    const delivery = await record.result; this.guard(); if (!("fence" in delivery)) throw new Error("Confirm this exact export preview before saving");
    if (delivery.fence.id !== input.exportId || "sha256:" + delivery.fence.sha256 !== input.sourceDigest) throw new Error("Native export identity changed");
    if (!record.save) {
      if (saving >= 2) throw new Error("Native save dialogs are busy");
      saving++;
      record.save = (async () => {
        const source = await artifactRuntime()!.resolve({ chatId: this.input.chatId, incarnationId: this.input.incarnationId, artifactId: delivery.fence.id });
        this.guard(); return perform({ ...delivery, mime: delivery.fence.mime, data: source.data.toString("base64") });
      })().finally(() => { saving--; });
    }
    return record.save;
  }
}
