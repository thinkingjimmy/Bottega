/**
 * [INPUT]: Depends on Electron BrowserWindow, shared Bases schemas, TrustedRendererContext, SurfaceWindowController, BasesService, and one-time renderer authority
 * [OUTPUT]: Provides registerBasesRendererIpc with per-channel roles, App-owned ownerKey/chat-residence fences, wire parsing, and structured mutation errors
 * [POS]: Bases renderer security boundary; global management remains main-only while App windows see only their resident Studio/use-chat projection
 */

import type { BrowserWindow } from "electron";
import {
  BASES_CHANNEL,
  type BaseMutationError,
  type PutAttachmentRequest,
} from "../../../../shared/bases-ipc";
import {
  baseAuthorizeMutationInputSchema,
  baseDeleteRowsInputSchema,
  baseExportCsvInputSchema,
  baseExportJsonInputSchema,
  baseExportXlsxInputSchema,
  baseGetInputSchema,
  baseImportJsonInputSchema,
  baseImportXlsxInputSchema,
  baseImportMutationResultSchema,
  baseInsertRowsInputSchema,
  basePatchRowInputSchema,
  baseRemoveManagedInputSchema,
  basePromoteToProjectInputSchema,
  baseMutationSnapshotResultSchema,
  baseResolveForSectionInputSchema,
  baseRowHistoryInputSchema,
  baseUpdateMetaInputSchema,
} from "../../../../shared/bases-schema";
import {
  listGalleryEntriesInputSchema,
  listGalleryEntriesResultSchema,
  putAttachmentRequestSchema,
  putAttachmentResultSchema,
  readAttachmentInputSchema,
  readAttachmentResultSchema,
  readAttachmentThumbnailInputSchema,
  readAttachmentThumbnailResultSchema,
} from "../../../../shared/bases/gallery-attachments";
import { rendererIpc } from "../../ipc-registrar";
import type { TrustedRendererContext } from "../../window/surfaces/trusted-renderer-context";
import { surfaceWindowController } from "../../window/surfaces/surface-window-controller";
import { errorMessage } from "../../errors";
import type { BaseCommitAuthority } from "../base-commit-authority";
import type { BasesService } from "../bases-service";

type RendererIpcAuthority = {
  authorize(input: ReturnType<typeof baseAuthorizeMutationInputSchema.parse>): Promise<unknown>;
  consume(leaseId: string): BaseCommitAuthority;
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
    baseGetInputSchema.parse(input).ownerKey;
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
      : service.assertRendererOwnerKey(value);
  };
  const visibleBases = <T extends { ownerKey: string }>(
    context: TrustedRendererContext,
    bases: T[]
  ) => {
    const currentAppId = appId(context);
    const visible = currentAppId
      ? bases.filter((base) => base.ownerKey === service.appRendererOwnerKey(currentAppId))
      : bases;
    return service.navigationBases(visible);
  };
  const assertChat = (
    context: TrustedRendererContext,
    input: { chatId: string; incarnationId: string }
  ) => surfaceWindowController.assertConversationSurfaceResidence({
    windowId: context.windowId,
    conversationId: input.chatId,
    conversationIncarnationId: input.incarnationId,
  });
  const ipc = rendererIpc(window, rendererUrl, "Rejected unauthorized Bases request");
  ipc
    .roles("main", "app-window")
    .handleWithContext(BASES_CHANNEL.get, (context, input) =>
      service.get(ownerKey(context, readOwnerKey(input))))
    .handleWithContext(BASES_CHANNEL.ensure, (context, input) =>
      service.ensure(ownerKey(context, readOwnerKey(input))))
    .handleWithContext(BASES_CHANNEL.discardCorrupt, (context, input) =>
      service.discardCorrupt(ownerKey(context, readOwnerKey(input)))
    )
    .handleWithContext(BASES_CHANNEL.listPinned, (context) => ({
      bases: visibleBases(context, service.store.listPinned()),
      ...(service.store.getWarning()
        ? { warning: service.store.getWarning() }
        : {}),
    }))
    .handleWithContext(BASES_CHANNEL.listProject, (context) => ({
      bases: visibleBases(context, service.store.listProjectBases()),
      ...(service.store.getWarning()
        ? { warning: service.store.getWarning() }
        : {}),
    }))
    .handleWithContext(BASES_CHANNEL.authorizeMutation, (context, input) => {
      const parsed = baseAuthorizeMutationInputSchema.parse(input);
      ownerKey(context, parsed.ownerKey);
      return authority.authorize(parsed);
    })
    .handleWithContext(BASES_CHANNEL.updateMeta, async (context, input) => {
      const { authorityLeaseId, ...mutation } = baseUpdateMetaInputSchema.parse(input);
      ownerKey(context, mutation.ownerKey);
      try {
        const snapshot = await service.updateMeta({
          ...mutation,
          authority: authority.consume(authorityLeaseId),
        });
        return { ok: true as const, snapshot };
      } catch (cause) {
        return snapshotErrorResult(cause);
      }
    })
    .handleWithContext(BASES_CHANNEL.insertRows, (context, input) => {
      const { authorityLeaseId, ...mutation } = baseInsertRowsInputSchema.parse(input);
      ownerKey(context, mutation.ownerKey);
      return service.insertRows({
        ...mutation,
        authority: authority.consume(authorityLeaseId),
      });
    })
    .handleWithContext(BASES_CHANNEL.patchRow, (context, input) => {
      const { authorityLeaseId, ...mutation } = basePatchRowInputSchema.parse(input);
      ownerKey(context, mutation.ownerKey);
      return service.patchRow({
        ...mutation,
        authority: authority.consume(authorityLeaseId),
      });
    })
    .handleWithContext(BASES_CHANNEL.deleteRows, async (context, input) => {
      const { authorityLeaseId, ...mutation } = baseDeleteRowsInputSchema.parse(input);
      ownerKey(context, mutation.ownerKey);
      try {
        const snapshot = await service.deleteRows({
          ...mutation,
          authority: authority.consume(authorityLeaseId),
        });
        return { ok: true as const, snapshot };
      } catch (cause) {
        return snapshotErrorResult(cause);
      }
    })
    .handleWithContext(BASES_CHANNEL.exportCsv, (context, input) => {
      const parsed = baseExportCsvInputSchema.parse(input);
      return service.exportForRenderer(ownerKey(context, parsed.ownerKey));
    })
    .handleWithContext(BASES_CHANNEL.exportJson, (context, input) => {
      const parsed = baseExportJsonInputSchema.parse(input);
      return service.exportJsonForRenderer(ownerKey(context, parsed.ownerKey));
    })
    .handleWithContext(BASES_CHANNEL.importJson, async (context, input) => {
      const parsed = baseImportJsonInputSchema.parse(input);
      ownerKey(context, parsed.ownerKey);
      try {
        const result = await service.importJsonForRenderer(
          parsed.ownerKey,
          authority.consume(parsed.authorityLeaseId),
          parsed.expectedRevision
        );
        return { ok: true as const, ...result };
      } catch (cause) {
        return importErrorResult(cause);
      }
    })
    .handleWithContext(BASES_CHANNEL.exportXlsx, (context, input) => {
      const parsed = baseExportXlsxInputSchema.parse(input);
      return service.exportXlsxForRenderer(ownerKey(context, parsed.ownerKey));
    })
    .handleWithContext(BASES_CHANNEL.importXlsx, async (context, input) => {
      const parsed = baseImportXlsxInputSchema.parse(input);
      ownerKey(context, parsed.ownerKey);
      try {
        const result = await service.importXlsxForRenderer(
          parsed.ownerKey,
          authority.consume(parsed.authorityLeaseId),
          parsed.expectedRevision
        );
        return { ok: true as const, ...result };
      } catch (cause) {
        return importErrorResult(cause);
      }
    })
    .handleWithContext(BASES_CHANNEL.rowHistory, async (context, input) => {
      const parsed = baseRowHistoryInputSchema.parse(input);
      ownerKey(context, parsed.ownerKey);
      return {
        entries: await service.rowHistory(parsed.ownerKey, parsed.rowId),
      };
    })
    .handleWithContext(BASES_CHANNEL.putAttachment, async (context, input) => {
      const parsed = putAttachmentRequestSchema.parse(input);
      ownerKey(context, parsed.ownerKey);
      return (
      putAttachmentResultSchema.parse(
        await authority.putAttachment(parsed)
      )
      );
    })
    .handleWithContext(BASES_CHANNEL.readAttachment, async (context, input) => {
      const parsed = readAttachmentInputSchema.parse(input);
      assertChat(context, parsed);
      return (
      readAttachmentResultSchema.parse(
        await service.readAttachment(parsed)
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
    .handle(BASES_CHANNEL.promoteToProject, (input) =>
      authority.promote(basePromoteToProjectInputSchema.parse(input))
    )
    .handle(BASES_CHANNEL.removeManaged, (input) => {
      const parsed = baseRemoveManagedInputSchema.parse(input);
      return service.removeManagedBase(
        service.assertRendererOwnerKey(parsed.ownerKey),
        parsed.ownerInstanceId
      );
    });

  const migrationEvents = service.store.drainMigrationEvents();
  const publishMigrations = () => {
    for (const event of migrationEvents) service.publishEvent(event);
  };
  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once("did-finish-load", publishMigrations);
  } else {
    queueMicrotask(publishMigrations);
  }
  window.once("closed", authority.closed);
}

/**
 * 只有失败分支过 schema：错误对象是现场拼的，形状没人替它把关；
 * 判别式 union 让 parse 直接落到 ok:false 那一支，不再牵动 snapshot。
 * 成功分支不重跑 zod——commitLocked 已逐行 parse 过，再 parse 一遍既是
 * O(rows) 白工，又会把「已经提交成功的 mutation」反报成 ok:false。
 */
function snapshotErrorResult(cause: unknown) {
  return baseMutationSnapshotResultSchema.parse({
    ok: false,
    error: mutationError(cause),
  });
}

function importErrorResult(cause: unknown) {
  return baseImportMutationResultSchema.parse({
    ok: false,
    error: mutationError(cause),
  });
}

function mutationError(cause: unknown): BaseMutationError {
  const value = cause && typeof cause === "object" ? cause : null;
  const code = value && "code" in value && typeof value.code === "string"
    ? value.code.slice(0, 128)
    : "mutation_failed";
  const currentRevision = value && "currentRevision" in value &&
      typeof value.currentRevision === "number"
    ? value.currentRevision
    : undefined;
  const issues = value && "issues" in value && Array.isArray(value.issues)
    ? value.issues
    : undefined;
  const detail = value && "detail" in value
    ? (value.detail as BaseMutationError["detail"])
    : undefined;
  return {
    code,
    message: errorMessage(cause).slice(0, 4_096) || "Base mutation 失败",
    ...(currentRevision === undefined ? {} : { currentRevision }),
    ...(issues?.length ? { issues } : {}),
    ...(detail?.columns.length ? { detail } : {}),
  };
}
