/**
 * [INPUT]: Depends on trusted renderer contexts, per-call Base authority, image staging, the shared thumbnail cache and the atomic record kernel.
 * [OUTPUT]: Registers role-filtered image parts, cancellation, owner previews and record commits with closed errors.
 * [POS]: Native image application boundary; every request rechecks owner lifecycle and the active App surface, while thumbnail cache instances initialize on first use.
 */
import type { BrowserWindow } from "electron";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { BASE_IMAGE_CHANNEL, imageBeginSchema, imagePartSchema, imageTransferSchema, imageThumbnailSchema,
  baseRecordCommitSchema, imageErrorSchema, type ImageScope, type ImageReply } from "@ai-chat/base-ui/attachments/native-images";
import type { BaseMutationOperation, BaseSnapshot } from "../../../../shared/bases-ipc";
import { rendererIpc } from "../../ipc-registrar";
import { rendererIdentity } from "../../window/renderer-identity";
import type { TrustedRendererContext } from "../../window/surfaces/trusted-renderer-context";
import { surfaceWindowController } from "../../window/surfaces/surface-window-controller";
import type { BasesService } from "../bases-service";
import { ownerFileStem } from "../store/base-files";
import { AttachmentThumbnailCache } from "../store/thumbnail-cache";
import { BaseImageStaging, imageError } from "./image-staging";
import { commitBaseRecord } from "./record-commit";
import { BASE_ATTACHMENT_JOB_LIMIT, BASE_ATTACHMENT_QUEUE_BYTES } from "../../../../shared/bases/gallery-attachments";

export class BaseImageService {
  private staging: BaseImageStaging | null = null;
  private thumbnails: AttachmentThumbnailCache | null = null;
  private previewJobs = 0;
  private previewBytes = 0;
  constructor(private readonly service: BasesService, private readonly options: {
    authorize(input: ImageScope, operation: BaseMutationOperation): Promise<void>;
    emit(snapshot: BaseSnapshot, rowId: string): void;
  }) {}
  private transfers() { return this.staging ??= new BaseImageStaging(this.service.store.attachments, async (bytes, value, signal) => {
    await this.thumbnailCache().get(`staging/${value.blobId}`, bytes, 160, signal);
  }); }
  private thumbnailCache() { return this.thumbnails ??= new AttachmentThumbnailCache(); }
  close() { return this.staging?.close() ?? Promise.resolve(); }

  register(window: BrowserWindow, rendererUrl: string) {
    const ipc = rendererIpc(rendererUrl, "Rejected unauthorized Base image request").roles("main", "app-window");
    const guard = async (context: TrustedRendererContext, input: ImageScope, operation?: BaseMutationOperation) => {
      if (context.window.isDestroyed() || rendererIdentity(context.webContentsId).rendererSessionId !== context.rendererIncarnation) throw imageError("base_scope_changed");
      if (context.role === "app-window") {
        if (!context.appId) throw imageError("base_scope_changed");
        surfaceWindowController.assertAppStudioMutation(context, context.appId);
        this.service.assertAppRendererOwnerKey(input.ownerKey, context.appId);
      }
      const identity = await this.service.ownerResolver.identityForOwnerKey(input.ownerKey);
      if (identity.ownerInstanceId !== input.ownerInstanceId || !this.service.store.peek(input.ownerKey, input.ownerInstanceId)) throw imageError("base_scope_changed");
      if (operation) await this.options.authorize(input, operation);
    };
    ipc.handleWithContext(BASE_IMAGE_CHANNEL.begin, (context, raw) => reply(async () => {
      const input = imageBeginSchema.parse(raw); await guard(context, input, "attachment-put");
      return this.transfers().begin(context, input);
    }));
    ipc.handleWithContext(BASE_IMAGE_CHANNEL.part, (context, raw) => reply(async () => {
      const input = imagePartSchema.parse(raw); await guard(context, input, "attachment-put");
      return this.transfers().part(context, input);
    }));
    ipc.handleWithContext(BASE_IMAGE_CHANNEL.finish, (context, raw) => reply(async () => {
      const input = imageTransferSchema.parse(raw); await guard(context, input, "attachment-put");
      return this.transfers().finish(context, input);
    }));
    ipc.handleWithContext(BASE_IMAGE_CHANNEL.cancel, (context, raw) => reply(async () => {
      // Cancellation only removes the caller's private staging, including after an owner was deleted.
      await this.staging?.cancel(context, imageTransferSchema.parse(raw)); return null;
    }));
    ipc.handleWithContext(BASE_IMAGE_CHANNEL.commitRecord, (context, raw) => reply(async () => {
      const input = baseRecordCommitSchema.parse(raw), operation = input.baselineValues === null ? "row-insert" : "row-patch";
      const authorize = () => guard(context, input, operation);
      await authorize();
      const commit = async (images: Parameters<typeof commitBaseRecord>[2]) => {
        const result = await commitBaseRecord(this.service.store, input, images, authorize);
        if (result.changed) this.options.emit(result.snapshot, input.rowId);
        return result.snapshot;
      };
      return Object.keys(input.stagedImages).length
        ? this.transfers().withReady(context, input, Object.values(input.stagedImages), commit)
        : commit(new Map());
    }));
    ipc.handleWithContext(BASE_IMAGE_CHANNEL.thumbnail, (context, raw) => reply(async () => {
      const input = imageThumbnailSchema.parse(raw); await guard(context, input);
      const currentValue = () => this.service.store.peek(input.ownerKey, input.ownerInstanceId)?.rows.some(row =>
        Object.values(row.values).some(value => isDeepStrictEqual(value, input.value)));
      if (!currentValue()) return null;
      if (this.previewJobs >= BASE_ATTACHMENT_JOB_LIMIT || this.previewBytes + input.value.byteLength > BASE_ATTACHMENT_QUEUE_BYTES) throw imageError("image_upload_limit");
      this.previewJobs++; this.previewBytes += input.value.byteLength;
      try {
        const bytes = await this.service.store.attachments.read(ownerFileStem(input.ownerKey), input.ownerInstanceId, input.value);
        const value = await this.thumbnailCache().get(`${input.ownerKey}/${input.ownerInstanceId}/${input.value.blobId}/${input.maxEdge}`, bytes, input.maxEdge);
        await guard(context, input); return currentValue() ? value : null;
      } finally { this.previewJobs--; this.previewBytes -= input.value.byteLength; }
    }));
    const webContentsId = window.webContents.id;
    window.once("closed", () => { void this.staging?.closeRenderer(webContentsId).catch(() => undefined); });
  }
}
async function reply<T>(run: () => Promise<T>): Promise<ImageReply<T>> {
  try { return { ok: true, value: await run() }; }
  catch (cause) {
    const candidate = cause instanceof Error && "code" in cause ? cause.code : undefined;
    const parsed = imageErrorSchema.safeParse(candidate);
    const code = parsed.success ? parsed.data : cause instanceof z.ZodError ? "invalid_record" : "record_save_failed";
    return { ok: false, error: { code, retryable: ["image_transfer_io", "record_save_failed"].includes(code) } };
  }
}
