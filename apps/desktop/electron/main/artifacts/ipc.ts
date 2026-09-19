/**
 * [INPUT]: Trusted top-frame IPC, immutable artifact custody, native dialogs and Base import transactions.
 * [OUTPUT]: Leases, explicit native snapshot actions and worksheet imports without renderer paths.
 * [POS]: Artifact renderer boundary; every operation revalidates the Chat incarnation.
 */
import { basename, extname } from "node:path";
import { writeFile } from "node:fs/promises";
import { BrowserWindow, dialog, shell } from "electron";
import { z } from "zod";
import { artifactViewerShell } from "@ai-chat/cloud-protocol/artifacts/viewer-shell";
import { ARTIFACT_IPC, artifactRefSchema } from "../../../shared/artifact-ipc";
import { rendererIpc } from "../ipc-registrar";
import type { BasesService } from "../bases/bases-service";
import { ArtifactBaseImporter } from "../bases/io/artifact-import";
import type { ArtifactService } from "./service";
const actionSchema = z.object({ ref: artifactRefSchema, action: z.enum(["quick-look", "reveal", "open", "save"]) }).strict();
const importSchema = z.object({ ref: artifactRefSchema, sheet: z.string().min(1).max(250), confirmed: z.boolean() }).strict();
export function registerArtifactIpc(window: BrowserWindow, rendererUrl: string, service: ArtifactService, bases: BasesService) {
  const importer = new ArtifactBaseImporter(service.root, bases);
  const ipc = rendererIpc(rendererUrl, "artifact-untrusted-frame").roles("main");
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
        const bytes = fence.kind === "html-fragment" ? artifactViewerShell({ html: snapshot.data.toString("utf8"), title: fence.title }) : snapshot.data;
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
