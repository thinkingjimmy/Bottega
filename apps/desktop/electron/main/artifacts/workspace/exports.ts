/**
 * [INPUT]: Authorized immutable revision, shared frozen export specification, existing custody and encrypted outbox.
 * [OUTPUT]: Source/resource/runtime/spec-bound idempotent export references and isolated flights through the private-file pipeline.
 * [POS]: Remote export boundary; bytes never enter an encrypted command receipt or a new version.
 */
import { createHash } from "node:crypto";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { artifactFenceSchema } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { artifactRuntime } from "../core/runtime";
import { exportDesignRevision } from "../../design/editing/export";
import { createDesignExportSpec } from "../../design/editing/export-spec";
import type { ArtifactWorkspace } from "./service";
const flights = new Map<string, Promise<unknown>>();
export async function transferDesignExport(input: WorkspaceCommand, workspace: ArtifactWorkspace) {
  const snapshot = await workspace.version(input), plan = await createDesignExportSpec(input, snapshot), artifacts = artifactRuntime()!;
  const id = "export_" + createHash("sha256").update(JSON.stringify([plan.spec.version, input.chatId, input.incarnationId, input.artifactId, plan.digest])).digest("hex");
  const ref = { chatId: input.chatId, incarnationId: input.incarnationId, artifactId: id };
  const existing = artifacts.custody.lookup(ref);
  if (!existing) {
    let flight = flights.get(id);
    if (!flight) {
      if (flights.size >= 2) throw new Error("artifact-export-busy");
      flight = (async () => {
        const result = await exportDesignRevision(input, snapshot, plan);
        const fence = artifactFenceSchema.parse({ v: 1, id, kind: "file", title: result.filename, mime: result.mime,
          bytes: Buffer.from(result.data, "base64").length, sha256: result.digest.slice(7), createdAt: Date.now() });
        await artifacts.retainExport({ ...ref, artifactId: input.artifactId! }, fence, Buffer.from(result.data, "base64"));
      })().finally(() => flights.delete(id));
      flights.set(id, flight);
    }
    await flight;
  }
  const result = await artifacts.resolve(ref), published = await artifacts.publisher.flushRef(ref);
  await workspace.version(input);
  return { fence: result.record.fence, filename: result.record.fence.title,
    revision: snapshot.version.revision, snapshotRef: snapshot.version.snapshotRef, readSetDigest: snapshot.version.readSetDigest,
    published };
}
