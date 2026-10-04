/**
 * [INPUT]: Trusted top-frame IPC, artifact custody, native dialogs, Base imports and the preview lifecycle owner.
 * [OUTPUT]: Path-free snapshot actions/imports and explicit preview control, including private-capture restart confirmation.
 * Availability reads reject unsupported or disabled tunnel owners without asking for download consent.
 * [POS]: Artifact renderer boundary; every operation revalidates the Chat incarnation.
 */
import { basename, extname } from "node:path";
import { writeFile } from "node:fs/promises";
import { BrowserWindow, dialog, shell } from "electron";
import { z } from "zod";
import { ARTIFACT_IPC, artifactRefSchema } from "../../../shared/ipc/apps/artifact-ipc";
import { rendererIpc } from "../registration/ipc-registrar";
import type { BasesService } from "../bases/bases-service";
import { ArtifactBaseImporter } from "../bases/io/artifact-import";
import type { ArtifactService } from "./service";
import { previewFeature } from "../preview/session/runtime";
const actionSchema = z.object({ ref: artifactRefSchema, action: z.enum(["quick-look", "reveal", "open", "save"]) }).strict();
const importSchema = z.object({ ref: artifactRefSchema, sheet: z.string().min(1).max(250), confirmed: z.boolean() }).strict();
export function registerArtifactIpc(window: BrowserWindow, rendererUrl: string, service: ArtifactService, bases: BasesService) {
  const importer = new ArtifactBaseImporter(service.root, bases);
  const ipc = rendererIpc(rendererUrl, "artifact-untrusted-frame").roles("main");
  ipc.handle(ARTIFACT_IPC.preview, async input => {
    const { ref, action } = z.object({ ref: artifactRefSchema, action: z.enum(["preview-status", "preview-start", "preview-stop", "preview-issue-code", "preview-keep-running"]) }).strict().parse(input);
    service.assert(ref);
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
  const windowId = window.webContents.id;
  window.once("closed", () => { service.gateway.releaseWindow(windowId); void importer.close(); });
}
