/**
 * [INPUT]: Depends on trusted renderer context/residence, Design shared DTOs, surface leases, and narrow AppsService Design ports
 * [OUTPUT]: Provides registerDesignIpc plus strict parsers for trusted import-candidate/import/history/restore, auto-open, visibility, and custody deletion; owner migration has no renderer channel
 * [POS]: apps/service/integrations Design renderer boundary; destructive owner identity comes only from main Project rebind evidence
 */

import {
  APPS_CHANNEL,
  type DesignAutoOpenInput,
  type DesignCanvasVersion,
  type DesignDataStatus,
} from "../../../../../shared/apps-ipc";
import type { RendererIpc } from "../../../ipc-registrar";
import { surfaceWindowController } from "../../../window/surfaces/surface-window-controller";
import type { TrustedRendererContext } from "../../../window/surfaces/trusted-renderer-context";
import type { AppAttachmentSurfaceLeaseRegistry } from "../../attachments/surface-leases";
import { assertSurfaceLeaseId } from "../../attachments/grant-inputs";
import { assertAppId } from "../../service-inputs";
import { isCanonicalDesignPath } from "../../../design/storage/canvas-registry";

type InternalDesignVersion = Omit<DesignCanvasVersion, "file"> & {
  canonicalRelativePath: string;
};

export type DesignIpcDependencies = Readonly<{
  surfaceLeases(): AppAttachmentSurfaceLeaseRegistry;
  importDesignCanvas(surfaceLeaseId: string, file: string): Promise<{ file: string }>;
  listDesignImportCandidates(surfaceLeaseId: string): Promise<readonly string[]>;
  listDesignFiles(surfaceLeaseId: string): Promise<readonly string[]>;
  listDesignVersions(surfaceLeaseId: string, file: string): Promise<readonly InternalDesignVersion[]>;
  restoreDesignVersion(surfaceLeaseId: string, versionId: string): Promise<InternalDesignVersion>;
  setDesignAutoOpen(input: {
    appId: string;
    chatId: string;
    conversationIncarnationId: string;
    suppressed: boolean;
  }): Promise<boolean>;
  designDataStatus(appId: string): DesignDataStatus;
  deleteDesignData(input: {
    appId: string;
    dataCustodyId: string;
    confirmed: true;
  }): Promise<boolean>;
  setDesignEnabled(appId: string, enabled: boolean): Promise<unknown>;
}>;

export function registerDesignIpc(ipc: RendererIpc, deps: DesignIpcDependencies) {
  ipc
    .handleWithContext(APPS_CHANNEL.listDesignFiles, async (context, raw) => {
      const input = assertDesignSurfaceObject(raw, ["appId", "appSurfaceLeaseId"]);
      await assertTrustedSurface(context, input, deps);
      return deps.listDesignFiles(input.appSurfaceLeaseId);
    })
    .handleWithContext(APPS_CHANNEL.listDesignImportCandidates, async (context, raw) => {
      const input = assertDesignSurfaceObject(raw, ["appId", "appSurfaceLeaseId"]);
      await assertTrustedSurface(context, input, deps);
      return deps.listDesignImportCandidates(input.appSurfaceLeaseId);
    })
    .handleWithContext(APPS_CHANNEL.importDesignCanvas, async (context, raw) => {
      const input = assertDesignFileInput(raw);
      await assertTrustedSurface(context, input, deps);
      return deps.importDesignCanvas(input.appSurfaceLeaseId, input.file);
    })
    .handleWithContext(APPS_CHANNEL.listDesignVersions, async (context, raw) => {
      const input = assertDesignFileInput(raw);
      await assertTrustedSurface(context, input, deps);
      return (await deps.listDesignVersions(input.appSurfaceLeaseId, input.file))
        .map(publicVersion);
    })
    .handleWithContext(APPS_CHANNEL.restoreDesignVersion, async (context, raw) => {
      const input = assertDesignRestoreInput(raw);
      await assertTrustedSurface(context, input, deps);
      return publicVersion(
        await deps.restoreDesignVersion(input.appSurfaceLeaseId, input.versionId)
      );
    })
    .handleWithContext(APPS_CHANNEL.setDesignAutoOpen, (context, raw) => {
      const input = assertDesignAutoOpenInput(raw);
      surfaceWindowController.assertConversationSurfaceResidence({
        windowId: context.windowId,
        conversationId: input.conversationId,
        conversationIncarnationId: input.conversationIncarnationId,
      });
      return deps.setDesignAutoOpen({
        appId: input.appId,
        chatId: input.conversationId,
        conversationIncarnationId: input.conversationIncarnationId,
        suppressed: input.suppressed,
      });
    })
    .handleWithContext(APPS_CHANNEL.designDataStatus, (context, rawAppId) => {
      const appId = assertAppId(rawAppId);
      surfaceWindowController.assertAppStudioMutation(context, appId);
      return deps.designDataStatus(appId);
    })
    .handleWithContext(APPS_CHANNEL.deleteDesignData, (context, raw) => {
      const input = assertDeleteDesignData(raw);
      surfaceWindowController.assertAppStudioMutation(context, input.appId);
      return deps.deleteDesignData(input);
    })
    .handleWithContext(APPS_CHANNEL.setDesignEnabled, (context, raw) => {
      const input = assertDesignEnabled(raw);
      surfaceWindowController.assertAppStudioMutation(context, input.appId);
      return deps.setDesignEnabled(input.appId, input.enabled);
    });
}

async function assertTrustedSurface(
  context: TrustedRendererContext,
  input: { appId: string; appSurfaceLeaseId: string },
  deps: DesignIpcDependencies
) {
  const surface = await deps.surfaceLeases().describe(input.appSurfaceLeaseId);
  if (surface.appId !== input.appId) throw new Error("Design surface App mismatch");
  if (surface.mode === "studio") {
    surfaceWindowController.assertSurfaceResidence({
      windowId: context.windowId,
      appId: surface.appId,
      conversationId: surface.conversationId,
      conversationIncarnationId: surface.conversationIncarnationId,
    });
    return;
  }
  surfaceWindowController.assertConversationSurfaceResidence({
    windowId: context.windowId,
    conversationId: surface.conversationId,
    conversationIncarnationId: surface.conversationIncarnationId,
  });
}

function assertDesignFileInput(raw: unknown) {
  const input = assertDesignSurfaceObject(raw, ["appId", "appSurfaceLeaseId", "file"]);
  const file = (raw as { file?: unknown }).file;
  // 与 registry 的 canonical 判定同源，避免 IPC 校验器与身份规则漂移（大小写别名）。
  if (typeof file !== "string" || !isCanonicalDesignPath(file)) {
    throw new Error("Design canvas path invalid");
  }
  return { ...input, file };
}

function assertDesignRestoreInput(raw: unknown) {
  const input = assertDesignSurfaceObject(raw, [
    "appId",
    "appSurfaceLeaseId",
    "versionId",
    "confirmed",
  ]);
  const { confirmed, versionId } = raw as { confirmed?: unknown; versionId?: unknown };
  if (confirmed !== true || typeof versionId !== "string" || !isUuid(versionId)) {
    throw new Error("Design restore confirmation invalid");
  }
  return { ...input, versionId, confirmed: true as const };
}

function assertDesignSurfaceObject(raw: unknown, keys: readonly string[]) {
  const input = assertExactObject(raw, keys, "Design surface input invalid");
  return {
    ...input,
    appId: assertAppId(input.appId),
    appSurfaceLeaseId: assertSurfaceLeaseId(input.appSurfaceLeaseId),
  };
}

function assertDesignAutoOpenInput(raw: unknown): DesignAutoOpenInput {
  const input = assertExactObject(raw, [
    "appId",
    "conversationId",
    "conversationIncarnationId",
    "suppressed",
  ], "Design auto-open input invalid");
  if (
    typeof input.conversationId !== "string" ||
    typeof input.conversationIncarnationId !== "string" ||
    typeof input.suppressed !== "boolean"
  ) throw new Error("Design auto-open input invalid");
  return {
    appId: assertAppId(input.appId),
    conversationId: input.conversationId,
    conversationIncarnationId: input.conversationIncarnationId,
    suppressed: input.suppressed,
  };
}

function publicVersion(version: InternalDesignVersion): DesignCanvasVersion {
  return {
    versionId: version.versionId,
    file: version.canonicalRelativePath,
    digest: version.digest,
    source: version.source,
    parentVersion: version.parentVersion,
    ...(version.restoredFromVersion
      ? { restoredFromVersion: version.restoredFromVersion }
      : {}),
    provenance: version.provenance,
    createdAt: version.createdAt,
  };
}

function assertDeleteDesignData(raw: unknown) {
  const input = assertExactObject(
    raw,
    ["appId", "dataCustodyId", "confirmed"],
    "Design command invalid"
  );
  if (input.confirmed !== true || typeof input.dataCustodyId !== "string" || !isUuid(input.dataCustodyId)) {
    throw new Error("Design data deletion confirmation invalid");
  }
  return {
    appId: assertAppId(input.appId),
    dataCustodyId: input.dataCustodyId,
    confirmed: true as const,
  };
}

function assertDesignEnabled(raw: unknown) {
  const input = assertExactObject(raw, ["appId", "enabled"], "Design enabled input invalid");
  if (typeof input.enabled !== "boolean") throw new Error("Design enabled input invalid");
  return { appId: assertAppId(input.appId), enabled: input.enabled };
}

function assertExactObject(raw: unknown, keys: readonly string[], message: string) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(message);
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).length !== keys.length || keys.some((key) => !(key in input))) {
    throw new Error(message);
  }
  return input;
}

const isUuid = (value: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
