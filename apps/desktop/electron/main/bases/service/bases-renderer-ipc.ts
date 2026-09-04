/**
 * [INPUT]: Depends on Electron BrowserWindow, shared Bases schemas, TrustedRendererContext, SurfaceWindowController, BasesService, and the per-call renderer commit authority
 * [OUTPUT]: Provides registerBasesRendererIpc with per-channel roles, App-owned ownerKey/chat-residence fences, caller-supplied App surface leases forwarded to authority minting, wire parsing, and structured mutation errors
 * [POS]: Bases renderer security boundary; global management remains main-only while App windows see only their resident Studio/use-chat projection
 */

import type { BrowserWindow } from "electron";
import {
  BASES_CHANNEL,
  type BaseMutationError,
  type BaseMutationOperation,
  type PutAttachmentRequest,
} from "../../../../shared/bases-ipc";
import {
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
  readAttachmentThumbnailInputSchema,
  readAttachmentThumbnailResultSchema,
} from "../../../../shared/bases/gallery-attachments";
import { rendererIpc } from "../../ipc-registrar";
import type { TrustedRendererContext } from "../../window/surfaces/trusted-renderer-context";
import { surfaceWindowController } from "../../window/surfaces/surface-window-controller";
import { errorMessage } from "../../errors";
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
  const ipc = rendererIpc(window, rendererUrl, "Rejected unauthorized Bases request");
  ipc
    .roles("main", "app-window")
    .handleWithContext(BASES_CHANNEL.get, (context, input) =>
      service.get(ownerKey(context, readOwnerKey(input))))
    .handleWithContext(BASES_CHANNEL.ensure, (context, input) =>
      service.ensure(ownerKey(context, readOwnerKey(input))))
    .handleWithContext(BASES_CHANNEL.listRoot, (context) => ({
      bases: visibleBases(context, service.store.listRootBases()),
    }))
    .handleWithContext(BASES_CHANNEL.listProject, (context) => ({
      bases: visibleBases(context, service.store.listProjectBases()),
    }))
    .handleWithContext(BASES_CHANNEL.updateMeta, async (context, input) => {
      const parsed = baseUpdateMetaInputSchema.parse(input);
      const { surfaceLeaseId: _lease, ...mutation } = parsed;
      const granted = await mutationAuthority(context, parsed, "meta");
      try {
        const snapshot = await service.updateMeta({ ...mutation, authority: granted });
        return { ok: true as const, snapshot };
      } catch (cause) {
        return snapshotErrorResult(cause);
      }
    })
    .handleWithContext(BASES_CHANNEL.insertRows, async (context, input) => {
      const parsed = baseInsertRowsInputSchema.parse(input);
      const { surfaceLeaseId: _lease, ...mutation } = parsed;
      return service.insertRows({
        ...mutation,
        authority: await mutationAuthority(context, parsed, "row-insert"),
      });
    })
    .handleWithContext(BASES_CHANNEL.patchRow, async (context, input) => {
      const parsed = basePatchRowInputSchema.parse(input);
      const { surfaceLeaseId: _lease, ...mutation } = parsed;
      return service.patchRow({
        ...mutation,
        authority: await mutationAuthority(context, parsed, "row-patch"),
      });
    })
    .handleWithContext(BASES_CHANNEL.deleteRows, async (context, input) => {
      const parsed = baseDeleteRowsInputSchema.parse(input);
      const { surfaceLeaseId: _lease, ...mutation } = parsed;
      const granted = await mutationAuthority(context, parsed, "row-delete");
      try {
        const snapshot = await service.deleteRows({ ...mutation, authority: granted });
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
      const granted = await mutationAuthority(context, parsed, "json-import");
      try {
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
    .handleWithContext(BASES_CHANNEL.exportXlsx, (context, input) => {
      const parsed = baseExportXlsxInputSchema.parse(input);
      return service.exportXlsxForRenderer(ownerKey(context, parsed.ownerKey));
    })
    .handleWithContext(BASES_CHANNEL.importXlsx, async (context, input) => {
      const parsed = baseImportXlsxInputSchema.parse(input);
      const granted = await mutationAuthority(context, parsed, "xlsx-import");
      try {
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
      ownerKey(context, parsed.ownerKey);
      return {
        entries: await service.rowHistory(parsed.ownerKey, parsed.rowId),
      };
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
