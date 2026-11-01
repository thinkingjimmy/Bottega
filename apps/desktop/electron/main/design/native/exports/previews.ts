/**
 * [INPUT]: Exact live native consumer, fixed source/options and original transformed-model or exact-picture producer.
 * [OUTPUT]: Two bounded expiring preview tickets, authenticated image bytes and existing-only exact-output confirmation.
 * [POS]: Main-owned transient preview authority; it publishes nothing and never accepts renderer-produced bytes.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { designDigest } from "../../documents/model";
import { nativeExportJobSchema, planNativeExportJob, type PreparedNativeExport } from "./jobs";
import { produceNativeExport } from "./renderer";
import type { NativeExportSnapshot } from "./plan";
export const nativePreviewRequestSchema = nativeExportJobSchema.extend({ previewMode: z.enum(["basic", "raster"]) }).strict();
export const cancelNativePreviewSchema = z.object({ cancelPreview: z.string().uuid() }).strict();
type Request = z.infer<typeof nativeExportJobSchema>;
let retainedPreviewBytes = 0;
type Ticket = { bytes: number; intent: string; source: string; expiresAt: number; timer: ReturnType<typeof setTimeout>; controller: AbortController;
  request: Request; prepared: Promise<PreparedNativeExport>; pages: { requestId: string; mime: string; digest: string }[] };
export class NativeExportPreviews {
  private readonly tickets = new Map<string, Ticket>();
  constructor(private readonly input: WorkspaceCommand, private readonly windowId: number, private readonly guard: () => void) {}
  private ticket(id: string) { this.guard(); const value = this.tickets.get(id); if (!value || value.expiresAt <= Date.now()) { this.cancel(id); throw new Error("The concrete export preview expired. Review it again"); } return value; }
  cancel(id: string) { const ticket = this.tickets.get(id); if (ticket) { this.tickets.delete(id); clearTimeout(ticket.timer); retainedPreviewBytes -= ticket.bytes; ticket.controller.abort(new Error("The concrete export preview closed")); } return { cancelled: true }; }
  close() { for (const id of this.tickets.keys()) this.cancel(id); }
  assert(id: string) { this.ticket(id); }
  async prepare(raw: z.infer<typeof nativePreviewRequestSchema>, snapshot: NativeExportSnapshot) {
    this.guard();
    if (raw.options.format !== "pptx" || snapshot.version.manifest.contentFormat !== "slides/v4" || raw.options.fonts && raw.options.fonts.mode !== "strict") throw new Error("Choose an original basic-font or picture PPTX preview");
    const variant = raw.previewMode === "basic" ? "basic" : "pictures";
    if (raw.options.variant !== variant) throw new Error("The concrete font preview does not match this PPTX variant");
    const normalized = await planNativeExportJob(this.input, snapshot, { options: { ...raw.options, fonts: { mode: raw.previewMode,
      confirmation: { previewId: "11111111-1111-4111-8111-111111111111", previewDigest: "sha256:" + "0".repeat(64) } } }, ...(raw.files ? { files: raw.files } : {}) });
    const intent = normalized.plan.digest;
    for (const [id, ticket] of this.tickets) if (ticket.source !== snapshot.version.snapshotRef || ticket.expiresAt <= Date.now()) this.cancel(id);
    let id = [...this.tickets].find(([, ticket]) => ticket.intent === intent)?.[0];
    if (!id) {
      if (this.tickets.size >= 2) throw new Error("Close one of the two export previews before creating another");
      id = randomUUID(); const previewDigest = designDigest(JSON.stringify([id, this.input.viewId, this.input.generation, intent]));
      const request = { options: { ...raw.options, fonts: { mode: raw.previewMode, confirmation: { previewId: id, previewDigest } } }, ...(raw.files ? { files: raw.files } : {}) } as Request;
      const controller = new AbortController(), expiresAt = Date.now() + 10 * 60_000;
      const timer = setTimeout(() => this.cancel(id!), 10 * 60_000); timer.unref();
      const ticket: Ticket = { bytes: 0, intent, source: snapshot.version.snapshotRef, expiresAt, timer, controller, request, pages: [], prepared: Promise.resolve(undefined as never) };
      this.tickets.set(id, ticket);
      ticket.prepared = (async () => {
        const { plan } = await planNativeExportJob(this.input, snapshot, request); this.guard();
        const result = await produceNativeExport(this.input, snapshot, plan, this.windowId, AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)])); this.ticket(id!);
        if (result.previews.length !== plan.spec.options.pages.length) throw new Error("Every selected slide needs its concrete export preview");
        const bytes = result.bytes.length + result.previews.reduce((sum, image) => sum + image.data.length, 0);
        if (retainedPreviewBytes + bytes > 96 * 1024 * 1024) throw new Error("The native preview memory budget is full. Close another export preview");
        retainedPreviewBytes += bytes; ticket.bytes = bytes;
        ticket.pages = result.previews.map(image => ({ requestId: randomUUID(), mime: image.mime, digest: image.digest }));
        return { plan, result };
      })();
      void ticket.prepared.catch(() => { this.cancel(id!); });
    }
    const ticket = this.ticket(id), { plan, result } = await ticket.prepared; this.ticket(id);
    const families = result.fontProof.flatMap(proof => proof && typeof proof === "object" && "families" in proof && Array.isArray(proof.families) ? proof.families.filter((value): value is string => typeof value === "string") : []);
    return { published: false, request: ticket.request, preview: { id, digest: plan.spec.options.fonts.mode === "strict" ? "" : plan.spec.options.fonts.confirmation.previewDigest,
      mode: raw.previewMode, expiresAt: ticket.expiresAt, outputDigest: result.digest, pages: ticket.pages, warnings: result.warnings.slice(0, 16),
      description: raw.previewMode === "basic" ? "Editable basic-font PPTX. Fonts are not embedded. Substituted families: " + [...new Set(families)].join(", ") + ". This preview shows the original substituted layout on " + process.platform + "; other computers may change fonts or line breaks." : "Picture PPTX. These are the exact slide images in your file. Slide text and objects will not be editable. Speaker notes follow your chosen option." } };
  }
  async confirm(request: Request, snapshot: NativeExportSnapshot) {
    const fonts = request.options.fonts;
    if (!fonts || fonts.mode === "strict") return undefined;
    const ticket = this.ticket(fonts.confirmation.previewId);
    if (ticket.source !== snapshot.version.snapshotRef) throw new Error("The source changed. Review a new export preview");
    const original = await ticket.prepared, { plan } = await planNativeExportJob(this.input, snapshot, request); this.ticket(fonts.confirmation.previewId);
    if (plan.digest !== original.plan.digest) throw new Error("The concrete export preview or its options changed");
    return original;
  }
  async read(id: string) {
    for (const [ticketId, ticket] of this.tickets) {
      const index = ticket.pages.findIndex(page => "native-" + page.requestId === id);
      if (index < 0) continue;
      this.ticket(ticketId); const { result } = await ticket.prepared; this.ticket(ticketId); return result.previews[index];
    }
    return undefined;
  }
}
