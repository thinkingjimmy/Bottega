/**
 * [INPUT]: Depends on Electron BrowserWindow, shared Bases schemas, TrustedRendererContext, SurfaceWindowController, BasesService, and the per-call renderer commit authority
 * [OUTPUT]: Provides registerBasesRendererIpc with per-channel roles (Create Base of a Project and promotion are main-window only), App-owned ownerKey/chat-residence fences, caller-supplied App surface leases forwarded to authority minting, wire parsing, and coded refusals for every snapshot call and row history (renderer-results.ts)
 * [POS]: Bases renderer security boundary; global management remains main-only while App windows see only their resident Studio/use-chat projection
 */

import type { BrowserWindow } from "electron";
import {
  BASES_CHANNEL,
  type BaseMutationOperation,
  type PutAttachmentRequest,
} from "../../../../shared/bases/model/bases-ipc";
import {
  baseDeleteRowsInputSchema,
  baseImportInputSchema,
  baseInsertRowsInputSchema,
  baseOwnerInputSchema,
  basePatchRowInputSchema,
  baseRemoveManagedInputSchema,
  basePromoteToProjectInputSchema,
  baseCreateProjectBaseInputSchema,
  baseResolveForSectionInputSchema,
  baseRowHistoryInputSchema,
  baseUpdateMetaInputSchema,
} from "../../../../shared/bases/model/bases-schema";
import {
  listGalleryEntriesInputSchema,
  listGalleryEntriesResultSchema,
  putAttachmentRequestSchema,
  putAttachmentResultSchema,
  readAttachmentThumbnailInputSchema,
  readAttachmentThumbnailResultSchema,
} from "../../../../shared/bases/gallery-attachments";
import { rendererIpc } from "../../registration/ipc-registrar";
import type { TrustedRendererContext } from "../../window/surfaces/trusted-renderer-context";
import { surfaceWindowController } from "../../window/surfaces/surface-window-controller";
import { ensureResult, importErrorResult, mutationError, snapshotResult } from "./renderer-results";
import type { BaseCommitAuthority } from "./base-commit-authority";
import type { BasesService } from "../bases-service";

type RendererIpcAuthority = {
  rendererAuthority(input: {
    ownerKey: string;
    operation: BaseMutationOperation;
    expectedRevision: number | null;
    surfaceLeaseId?: string;
  }): Promise<BaseCommitAuthority>;
  putAttachment(input: PutAttachmentRequest): Promise<unknown>;
  promote(input: ReturnType<typeof basePromoteToProjectInputSchema.parse>): Promise<unknown>;
  closed(): void;
};

export function registerBasesRendererIpc(
  window: BrowserWindow,
  rendererUrl: string,
  service: BasesService,
  authority: RendererIpcAuthority
) {
  const readOwnerKey = (input: unknown) =>
    baseOwnerInputSchema.parse(input).ownerKey;
  const appId = (context: TrustedRendererContext) => {
    if (context.role !== "app-window") return null;
    if (!context.appId) throw new Error("App window identity is missing");
    surfaceWindowController.assertAppStudioMutation(context, context.appId);
    return context.appId;
  };
  const ownerKey = (context: TrustedRendererContext, value: string) => {
    const currentAppId = appId(context);
    return currentAppId
      ? service.assertAppRendererOwnerKey(value, currentAppId)
      : value;
  };
  const visibleBases = <T extends { ownerKey: string }>(
    context: TrustedRendererContext,
    bases: T[]
  ) => {
    const currentAppId = appId(context);
    if (!currentAppId) return bases;
    const owned = service.appRendererOwnerKey(currentAppId);
    return bases.filter((base) => base.ownerKey === owned);
  };
  const assertChat = (
    context: TrustedRendererContext,
    input: { chatId: string; incarnationId: string }
  ) => surfaceWindowController.assertConversationSurfaceResidence({
    windowId: context.windowId,
    conversationId: input.chatId,
    conversationIncarnationId: input.incarnationId,
  });
  /* 写入资格的唯一入口：先过与读同一道 owner fence，再把调用方自带的
     App surface lease 原样交给 service 去验活。lease 缺席不代表越权——
     主窗口与 App window 的资格本来就由 ownerKey fence 判定；lease 只是
     「我是某张活着的 App surface」这条额外声明。
     revision 一律不预判：CAS 由 owner queue 内核裁决。 */
  const mutationAuthority = (
    context: TrustedRendererContext,
    input: { ownerKey: string; surfaceLeaseId?: string },
    operation: BaseMutationOperation
  ) => {
    ownerKey(context, input.ownerKey);
    return authority.rendererAuthority({
      ownerKey: input.ownerKey,
      operation,
      expectedRevision: null,
      ...(input.surfaceLeaseId ? { surfaceLeaseId: input.surfaceLeaseId } : {}),
    });
  };
  const ipc = rendererIpc(rendererUrl, "Rejected unauthorized Bases request");
  ipc
    .roles("main", "app-window")
    .handleWithContext(BASES_CHANNEL.get, (context, input) =>
      service.get(ownerKey(context, readOwnerKey(input))))
    .handleWithContext(BASES_CHANNEL.recovery, (context, input) => {
      const value = service.store.incomplete(ownerKey(context, readOwnerKey(input)));
      return value ? { files: value.files, reason: value.reason } : null;
    })
    .handleWithContext(BASES_CHANNEL.ensure, (context, input) => {
      const key = readOwnerKey(input);
      return ensureResult(key, (value) => ownerKey(context, value), (value) => service.ensure(value));
    })
    .handleWithContext(BASES_CHANNEL.listRoot, (context) => ({
      bases: visibleBases(context, service.store.listRootBases()),
    }))
    .handleWithContext(BASES_CHANNEL.listProject, (context) => ({
      bases: visibleBases(context, service.store.listProjectBases()),
    }))
    .handleWithContext(BASES_CHANNEL.updateMeta, async (context, input) => {
      const parsed = baseUpdateMetaInputSchema.parse(input);
      const { surfaceLeaseId: _lease, ...mutation } = parsed;
      return snapshotResult(async () =>
        service.updateMeta({ ...mutation, authority: await mutationAuthority(context, parsed, "meta") }));
    })
    .handleWithContext(BASES_CHANNEL.insertRows, async (context, input) => {
      const parsed = baseInsertRowsInputSchema.parse(input);
      const { surfaceLeaseId: _lease, ...mutation } = parsed;
      return snapshotResult(async () =>
        service.insertRows({ ...mutation, authority: await mutationAuthority(context, parsed, "row-insert") }));
    })
    .handleWithContext(BASES_CHANNEL.patchRow, async (context, input) => {
      const parsed = basePatchRowInputSchema.parse(input);
      const { surfaceLeaseId: _lease, ...mutation } = parsed;
      return snapshotResult(async () =>
        service.patchRow({ ...mutation, authority: await mutationAuthority(context, parsed, "row-patch") }));
    })
    .handleWithContext(BASES_CHANNEL.deleteRows, async (context, input) => {
      const parsed = baseDeleteRowsInputSchema.parse(input);
      const { surfaceLeaseId: _lease, ...mutation } = parsed;
      return snapshotResult(async () =>
        service.deleteRows({ ...mutation, authority: await mutationAuthority(context, parsed, "row-delete") }));
    })
    .handleWithContext(BASES_CHANNEL.exportCsv, (context, input) =>
      service.exportForRenderer(ownerKey(context, readOwnerKey(input))))
    .handleWithContext(BASES_CHANNEL.exportJson, (context, input) =>
      service.exportJsonForRenderer(ownerKey(context, readOwnerKey(input))))
    .handleWithContext(BASES_CHANNEL.importJson, async (context, input) => {
      const parsed = baseImportInputSchema.parse(input);
      try {
        const granted = await mutationAuthority(context, parsed, "json-import");
        const result = await service.importJsonForRenderer(
          parsed.ownerKey,
          granted,
          parsed.expectedRevision
        );
        return { ok: true as const, ...result };
      } catch (cause) {
        return importErrorResult(cause);
      }
    })
    .handleWithContext(BASES_CHANNEL.exportXlsx, (context, input) =>
      service.exportXlsxForRenderer(ownerKey(context, readOwnerKey(input))))
    .handleWithContext(BASES_CHANNEL.importXlsx, async (context, input) => {
      const parsed = baseImportInputSchema.parse(input);
      try {
        const granted = await mutationAuthority(context, parsed, "xlsx-import");
        const result = await service.importXlsxForRenderer(
          parsed.ownerKey,
          granted,
          parsed.expectedRevision
        );
        return { ok: true as const, ...result };
      } catch (cause) {
        return importErrorResult(cause);
      }
    })
    .handleWithContext(BASES_CHANNEL.rowHistory, async (context, input) => {
      const parsed = baseRowHistoryInputSchema.parse(input);
      try {
        ownerKey(context, parsed.ownerKey);
        return { ok: true as const, entries: await service.rowHistory(parsed.ownerKey, parsed.rowId) };
      } catch (cause) {
        return { ok: false as const, error: mutationError(cause) };
      }
    })
    .handleWithContext(BASES_CHANNEL.putAttachment, async (context, input) => {
      const parsed = putAttachmentRequestSchema.parse(input);
      /* 附件的 authority 由 service 自己签发（它还要对 ownerInstanceId
         做一次 fence），这里只把同一道 owner fence 先关上。 */
      ownerKey(context, parsed.ownerKey);
      return (
      putAttachmentResultSchema.parse(
        await authority.putAttachment(parsed)
      )
      );
    })
    .handleWithContext(BASES_CHANNEL.readAttachmentThumbnail, async (context, input) => {
      const parsed = readAttachmentThumbnailInputSchema.parse(input);
      assertChat(context, parsed);
      return (
      readAttachmentThumbnailResultSchema.parse(
        await service.readAttachmentThumbnail(parsed)
      )
      );
    })
    .handleWithContext(BASES_CHANNEL.listGalleryEntries, async (context, input) => {
      const parsed = listGalleryEntriesInputSchema.parse(input);
      assertChat(context, parsed);
      return (
      listGalleryEntriesResultSchema.parse(
        await service.listGalleryEntries(parsed)
      )
      );
    })
    .handleWithContext(BASES_CHANNEL.resolveForSection, (context, input) => {
      const sectionId = baseResolveForSectionInputSchema.parse(input).sectionId;
      surfaceWindowController.assertConversationMutation(context, sectionId);
      return service.resolveForSection(sectionId);
    });

  ipc.roles("main")
    .handle(BASES_CHANNEL.createProjectBase, (input) =>
      service.createProjectBase(baseCreateProjectBaseInputSchema.parse(input).projectId))
    .handle(BASES_CHANNEL.promoteToProject, (input) =>
      authority.promote(basePromoteToProjectInputSchema.parse(input))
    )
    .handle(BASES_CHANNEL.removeManaged, (input) => {
      const parsed = baseRemoveManagedInputSchema.parse(input);
      return service.removeManagedBase(
        parsed.ownerKey,
        parsed.ownerInstanceId
      );
    });

  window.once("closed", authority.closed);
}
