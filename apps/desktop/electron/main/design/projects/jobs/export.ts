/**
 * [INPUT]: One authenticated native consumer, immutable journal cuts and existing private Artifact custody/outbox.
 * [OUTPUT]: Real whole-folder progress/cancellation/retry and deterministic retained ZIP receipts for the same frozen cut.
 * [POS]: Read-only project export jobs; source publication and single-output producers keep their existing owners.
 */
import { artifactFenceSchema } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { projectExportRequestSchema, type ProjectExportRequest } from "@ai-chat/cloud-protocol/artifacts/design/export/project";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { artifactRuntime } from "../../../artifacts/core/runtime";
import { designDocuments } from "../../documents/runtime";
import type { DesignRevision } from "../../documents/store";
import { designDigest } from "../../documents/model";
import { exportDesignProject } from "../export";
import { ProjectJobOwner } from "./owner";
type Delivery = { fence: ReturnType<typeof artifactFenceSchema.parse>; filename: string; revision: number; snapshotRef: string; published: unknown };
export class ProjectExportJobs {
  private readonly owner = new ProjectJobOwner<Delivery>();
  constructor(private readonly input: WorkspaceCommand, private readonly guard: () => void) {}
  close() { this.owner.close(); }
  request(id: string, raw: ProjectExportRequest, snapshot: { version: DesignRevision }) {
    this.guard(); const { project } = projectExportRequestSchema.parse(raw);
    if (project.action === "status" || project.action === "cancel") return this.reply(id, project.action === "cancel" ? this.owner.cancel(id) : this.owner.status(id));
    const documents = designDocuments(), authority = documents.authority(this.input.chatId, this.input.incarnationId), selected = documents.store.revision(authority, snapshot.version.manifest.documentId, project.revision);
    if (!selected || selected.snapshotRef !== project.snapshotRef || selected.manifest.format !== snapshot.version.manifest.format || selected.manifest.contentFormat !== snapshot.version.manifest.contentFormat) throw new Error("The exact complete-project cut is unavailable to this editor");
    const identity = designDigest(JSON.stringify([this.input.chatId, this.input.incarnationId, selected.manifest.documentId, project.revision, project.snapshotRef]));
    const produce = async (signal: AbortSignal, progress: Parameters<typeof exportDesignProject>[2]["progress"]): Promise<Delivery> => {
      const current = () => { signal.throwIfAborted(); this.guard(); if (JSON.stringify(documents.authority(this.input.chatId, this.input.incarnationId)) !== JSON.stringify(authority)) throw new Error("The project export authority changed"); };
      current(); const artifacts = artifactRuntime()!, parent = { chatId: this.input.chatId, incarnationId: this.input.incarnationId, artifactId: this.input.artifactId! }, ref = { ...parent, artifactId: "export_" + identity.slice(7) };
      if (!artifacts.custody.lookup(ref)) {
        const output = await exportDesignProject(documents, selected, { signal, current, progress }); current();
        const fence = artifactFenceSchema.parse({ v: 1, id: ref.artifactId, kind: "file", title: output.filename, mime: "application/zip", bytes: output.bytes.length, sha256: output.digest.slice(7), createdAt: selected.createdAt });
        await artifacts.retainExport(parent, fence, output.bytes); current();
      }
      const result = await artifacts.metadata(ref); current(); const published = await artifacts.publisher.flushRef(ref); current();
      progress({ stage: "complete", completed: selected.revision, total: selected.revision });
      return { fence: result.fence, filename: result.fence.title, revision: selected.revision, snapshotRef: selected.snapshotRef, published };
    };
    return this.reply(id, project.action === "retry" ? this.owner.retry(id, identity, produce) : this.owner.start(id, identity, produce));
  }
  private reply(id: string, value: ReturnType<ProjectJobOwner<Delivery>["status"]>) {
    return { project: { state: value.state, ...(value.progress ? { progress: value.progress } : {}), ...(value.error ? { error: value.error } : {}) }, ...(value.result ? { ...value.result, requestId: id } : {}) };
  }
}
