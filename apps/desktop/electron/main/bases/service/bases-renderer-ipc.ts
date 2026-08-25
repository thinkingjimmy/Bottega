/**
 * [INPUT]: Depends on Electron BrowserWindow, Shared Bases IPC/schema, BasesService Open business front and one-time renderer authority Feedback
 * [OUTPUT]: Provides registerBasesRendererIpc, completes the main window channel registration, input wire, fail branch structured error and migration event release
 * [POS]: The IPC boundary of the renderer of bases/service; Only parse the wire and commission BasesService, not implement Base business rules
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
  /* 读面对投影 sink 开放；写面仍必须通过 authority 与 principal。 */
  const readOwnerKey = (input: unknown) =>
    baseGetInputSchema.parse(input).ownerKey;
  const mutationOwnerKey = (input: unknown) =>
    service.assertRendererOwnerKey(readOwnerKey(input));
  rendererIpc(window, rendererUrl, "拒绝非主窗口的 Bases 请求")
    .handle(BASES_CHANNEL.get, (input) => service.get(readOwnerKey(input)))
    .handle(BASES_CHANNEL.ensure, (input) => service.ensure(readOwnerKey(input)))
    .handle(BASES_CHANNEL.discardCorrupt, (input) =>
      service.discardCorrupt(mutationOwnerKey(input))
    )
    .handle(BASES_CHANNEL.listPinned, () => ({
      bases: service.navigationBases(service.store.listPinned()),
      ...(service.store.getWarning()
        ? { warning: service.store.getWarning() }
        : {}),
    }))
    .handle(BASES_CHANNEL.listProject, () => ({
      bases: service.navigationBases(service.store.listProjectBases()),
      ...(service.store.getWarning()
        ? { warning: service.store.getWarning() }
        : {}),
    }))
    .handle(BASES_CHANNEL.authorizeMutation, (input) =>
      authority.authorize(baseAuthorizeMutationInputSchema.parse(input))
    )
    .handle(BASES_CHANNEL.updateMeta, async (input) => {
      const { authorityLeaseId, ...mutation } = baseUpdateMetaInputSchema.parse(input);
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
    .handle(BASES_CHANNEL.insertRows, (input) => {
      const { authorityLeaseId, ...mutation } = baseInsertRowsInputSchema.parse(input);
      return service.insertRows({
        ...mutation,
        authority: authority.consume(authorityLeaseId),
      });
    })
    .handle(BASES_CHANNEL.patchRow, (input) => {
      const { authorityLeaseId, ...mutation } = basePatchRowInputSchema.parse(input);
      return service.patchRow({
        ...mutation,
        authority: authority.consume(authorityLeaseId),
      });
    })
    .handle(BASES_CHANNEL.deleteRows, async (input) => {
      const { authorityLeaseId, ...mutation } = baseDeleteRowsInputSchema.parse(input);
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
    .handle(BASES_CHANNEL.exportCsv, (input) =>
      service.exportForRenderer(baseExportCsvInputSchema.parse(input).ownerKey)
    )
    .handle(BASES_CHANNEL.exportJson, (input) =>
      service.exportJsonForRenderer(baseExportJsonInputSchema.parse(input).ownerKey)
    )
    .handle(BASES_CHANNEL.importJson, async (input) => {
      const parsed = baseImportJsonInputSchema.parse(input);
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
    .handle(BASES_CHANNEL.exportXlsx, (input) =>
      service.exportXlsxForRenderer(
        baseExportXlsxInputSchema.parse(input).ownerKey
      )
    )
    .handle(BASES_CHANNEL.importXlsx, async (input) => {
      const parsed = baseImportXlsxInputSchema.parse(input);
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
    .handle(BASES_CHANNEL.rowHistory, async (input) => {
      const parsed = baseRowHistoryInputSchema.parse(input);
      return {
        entries: await service.rowHistory(parsed.ownerKey, parsed.rowId),
      };
    })
    .handle(BASES_CHANNEL.putAttachment, async (input) =>
      putAttachmentResultSchema.parse(
        await authority.putAttachment(putAttachmentRequestSchema.parse(input))
      )
    )
    .handle(BASES_CHANNEL.readAttachment, async (input) =>
      readAttachmentResultSchema.parse(
        await service.readAttachment(readAttachmentInputSchema.parse(input))
      )
    )
    .handle(BASES_CHANNEL.readAttachmentThumbnail, async (input) =>
      readAttachmentThumbnailResultSchema.parse(
        await service.readAttachmentThumbnail(
          readAttachmentThumbnailInputSchema.parse(input)
        )
      )
    )
    .handle(BASES_CHANNEL.listGalleryEntries, async (input) =>
      listGalleryEntriesResultSchema.parse(
        await service.listGalleryEntries(listGalleryEntriesInputSchema.parse(input))
      )
    )
    .handle(BASES_CHANNEL.resolveForSection, (input) =>
      service.resolveForSection(
        baseResolveForSectionInputSchema.parse(input).sectionId
      )
    )
    .handle(BASES_CHANNEL.promoteToProject, (input) =>
      authority.promote(basePromoteToProjectInputSchema.parse(input))
    );

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
