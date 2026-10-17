/**
 * [INPUT]: Authorized immutable board snapshots, bounded sandboxed capture and existing Artifact derived-file custody.
 * [OUTPUT]: Preview-sized static JPEG references without scrollbars within the existing 96 KiB budget, serialized capture and identical local/remote thumbnail bytes.
 * [POS]: Workspace image reader; board initialization runs only in a disposable opaque capture, without source edits or document publication.
 */
import { createHash } from "node:crypto";
import { nativeImage } from "electron";
import { SerialQueue } from "../../persistence/serial-queue";
import { artifactRuntime } from "../core/runtime";
import { artifactFenceSchema } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { prepareDesignSnapshot } from "../../design/documents/rendering";
import { captureDesignCanvas } from "../../design/tooling/render-check";
import { designDigest } from "../../design/documents/model";
import type { ArtifactWorkspace } from "./service";
const queue = new SerialQueue(), flights = new Map<string, Promise<void>>();
// Replace cached images when rendering or preview resolution changes.
const THUMBNAIL_RENDER_VERSION = 4;
export async function designThumbnail(input: WorkspaceCommand, workspace: ArtifactWorkspace) {
  const snapshot = await workspace.version(input), artifacts = artifactRuntime()!, boardId = input.boardId ?? snapshot.version.manifest.launchBoard;
  const board = snapshot.version.manifest.boards.find(board => board.id === boardId); if (!board) throw new Error("Artifact board is unavailable");
  const id = "thumb_" + createHash("sha256").update(JSON.stringify([THUMBNAIL_RENDER_VERSION, input.chatId, input.incarnationId, input.artifactId, snapshot.version.snapshotRef, boardId])).digest("hex");
  const ref = { chatId: input.chatId, incarnationId: input.incarnationId, artifactId: id };
  if (!artifacts.custody.lookup(ref)) {
    let flight = flights.get(id);
    if (!flight) {
      if (flights.size >= 64) throw new Error("artifact-thumbnail-busy");
      flight = queue.enqueue(async () => {
        const prepared = await prepareDesignSnapshot(snapshot, boardId);
        const captured = await captureDesignCanvas({ html: prepared.html, viewport: "desktop", size: prepared.size, hideScrollbars: true, maxImageBytes: 192 * 1024, signal: AbortSignal.timeout(15_000) });
        const image = nativeImage.createFromBuffer(Buffer.from(captured.data, "base64")), size = image.getSize();
        let bytes: Buffer = Buffer.alloc(0);
        for (const width of [960, 640, 320]) {
          const ratio = Math.min(1, width / size.width, width * .75 / size.height);
          bytes = image.resize({ width: Math.max(1, Math.round(size.width * ratio)), height: Math.max(1, Math.round(size.height * ratio)) }).toJPEG(82);
          if (bytes.length <= 96 * 1024) break;
        }
        if (bytes.length > 96 * 1024) throw new Error("artifact-thumbnail-budget");
        const fence = artifactFenceSchema.parse({ v: 1, id, kind: "image", title: `${board.title.slice(0, 100)}-v${snapshot.version.revision}.jpg`, mime: "image/jpeg", bytes: bytes.length, sha256: designDigest(bytes).slice(7), createdAt: Date.now() });
        await artifacts.retainExport({ ...ref, artifactId: input.artifactId! }, fence, bytes);
      }).finally(() => flights.delete(id));
      flights.set(id, flight);
    }
    await flight;
  }
  const result = await artifacts.resolve(ref); await workspace.version(input);
  return { fence: result.record.fence, filename: result.record.fence.title, data: result.data.toString("base64"), mime: "image/jpeg",
    revision: snapshot.version.revision, snapshotRef: snapshot.version.snapshotRef, readSetDigest: snapshot.version.readSetDigest, published: false };
}
export async function transferDesignThumbnail(input: WorkspaceCommand, workspace: ArtifactWorkspace) {
  const { data: _data, mime: _mime, ...result } = await designThumbnail(input, workspace), artifacts = artifactRuntime()!;
  await artifacts.publisher.flush(); await workspace.version(input);
  return { ...result, published: artifacts.publisher.jobs().some(job => job.ref.artifactId === result.fence.id && job.ref.chatId === input.chatId && job.state === "published") };
}
