/**
 * [INPUT]: Trusted top-frame IPC, Artifact authority/domain errors, native dialogs, Base imports and preview lifecycle.
 * [OUTPUT]: ID-scoped file/import/preview actions, workspace requests with preserved refusal codes and shared exact-window lifetime binding and release.
 * [POS]: Artifact renderer boundary; every operation revalidates the Chat incarnation.
 */
import { basename, extname } from "node:path";
import { writeFile } from "node:fs/promises";
import { BrowserWindow, dialog, shell } from "electron";
import { z } from "zod";
import { ARTIFACT_IPC, artifactRefSchema } from "../../../../shared/ipc/apps/artifact-ipc";
import { rendererIpc } from "../../registration/ipc-registrar";
import type { BasesService } from "../../bases/bases-service";
import { ArtifactBaseImporter } from "../../bases/io/artifact-import";
import type { ArtifactService } from "../core/service";
import { previewFeature } from "../../preview/session/runtime";
import { assertArtifactAdmission } from "../admission/state";
import { artifactWorkspace, releaseArtifactWindow } from "../workspace/runtime";
import { DesignDocumentError } from "../../design/documents/model";
const actionSchema = z.object({ ref: artifactRefSchema, action: z.enum(["quick-look", "reveal", "open", "save"]) }).strict();
const importSchema = z.object({ ref: artifactRefSchema, sheet: z.string().min(1).max(250), confirmed: z.boolean() }).strict();
export function registerArtifactIpc(window: BrowserWindow, rendererUrl: string, service: ArtifactService, bases: BasesService) {
  const importer = new ArtifactBaseImporter(service.root, bases);
  const ipc = rendererIpc(rendererUrl, "artifact-untrusted-frame").roles("main");
  ipc.handleWithContext(ARTIFACT_IPC.workspace, async (context, input) => {
    try { return await artifactWorkspace().dispatch(input, context.webContentsId); }
    catch (cause) {
      // Electron preserves the message, but drops custom error properties such as code.
      if (cause instanceof DesignDocumentError) throw new Error(`${cause.code}: ${cause.message}`);
      throw cause;
    }
  });
  ipc.handle(ARTIFACT_IPC.preview, async input => {
    const { ref, action } = z.object({ ref: artifactRefSchema, action: z.enum(["preview-status", "preview-start", "preview-stop", "preview-issue-code", "preview-keep-running"]) }).strict().parse(input);
    service.assert(ref);
    if (action === "preview-start" || action === "preview-keep-running") assertArtifactAdmission();
    const feature = previewFeature(); if (!feature) throw new Error("tunnel-plugin-disabled");
    const scope = { serverId: ref.artifactId, chatId: ref.chatId, incarnationId: ref.incarnationId };
    feature.consent.assertAvailable();
    if (action === "preview-status") { const captured = feature.captures.view(scope); if (captured) return captured; }
    if (action === "preview-keep-running") {
      await feature.captures.keep(scope);
      void feature.sessions.warm(scope).catch(() => undefined);
      return feature.sessions.view(scope);
    }
    return feature.sessions.action(action, scope, "desktop");
  });
  ipc.handleWithContext(ARTIFACT_IPC.lease, (context, input) => service.gateway.issue(artifactRefSchema.parse(input), context.webContentsId));
  ipc.handleWithContext(ARTIFACT_IPC.release, (context, input) => service.gateway.release(z.string().uuid().parse(input), context.webContentsId));
  ipc.handleWithContext(ARTIFACT_IPC.action, async (context, input) => {
    const { ref, action } = actionSchema.parse(input);
    const snapshot = await service.resolve(ref);
    if (["open", "quick-look"].includes(action) && /^(?:text\/html|application\/(?:javascript|xhtml\+xml)|image\/svg\+xml)$/i.test(snapshot.record.fence.mime ?? "")) assertArtifactAdmission();
    const owner = BrowserWindow.fromId(context.window.id);
    if (!owner || owner.isDestroyed()) throw new Error("artifact-window-closed");
    if (action === "reveal") shell.showItemInFolder(snapshot.path);
    else if (action === "quick-look" && process.platform === "darwin") owner.previewFile(snapshot.path, snapshot.record.fence.title);
    else if (action === "save") {
      const title = snapshot.record.fence.title.replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").slice(0, 120) || "Artifact";
      const result = await dialog.showSaveDialog(owner, { defaultPath: title + (extname(title) ? "" : extname(basename(snapshot.path))) });
      if (!result.canceled && result.filePath) { service.assert(ref); const fence = snapshot.record.fence;
        /* The viewer shell carries ~60 KB of vendored assets: loaded only when a fragment is saved, not with main's startup bundle. */
        const bytes = fence.kind === "html-fragment" ? (await import("@ai-chat/cloud-protocol/artifacts/viewer-shell")).artifactViewerShell({ html: snapshot.data.toString("utf8"), title: fence.title }) : snapshot.data;
        await writeFile(result.filePath, bytes); }
    } else { const error = await shell.openPath(snapshot.path); if (error) throw new Error("artifact-open-failed"); }
  });
  ipc.handle(ARTIFACT_IPC.workbook, async input => {
    const ref = artifactRefSchema.parse(input), snapshot = await service.resolve(ref);
    if (snapshot.record.fence.kind !== "xlsx") throw new Error("artifact-not-workbook");
    return importer.inspect(ref, snapshot.record.fence.sha256!, snapshot.data);
  });
  ipc.handle(ARTIFACT_IPC.importBase, async input => {
    const { ref, sheet, confirmed } = importSchema.parse(input), snapshot = await service.resolve(ref);
    if (snapshot.record.fence.kind !== "xlsx") throw new Error("artifact-not-workbook");
    return importer.import(ref, snapshot.record.fence.sha256!, snapshot.data, sheet, confirmed, () => service.assert(ref));
  });
  observeArtifactWindow(window, service, () => { void importer.close(); });
}
export function observeArtifactWindow(window: BrowserWindow, service: ArtifactService, close: () => void) {
  const windowId = window.webContents.id;
  window.once("closed", () => { service.gateway.releaseWindow(windowId); releaseArtifactWindow(windowId); void import("../workspace/thumbnails").then(module => module.cancelThumbnailWindow(windowId)); close(); });
}
