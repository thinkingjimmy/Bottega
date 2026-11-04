/**
 * [INPUT]: Fixed native source, bounded document writes and optional exact attachment bytes.
 * [OUTPUT]: Complete validated atomic source replacement, or a refusal before any journal effect.
 * [POS]: Dashboard edit adapter; the existing design document journal remains the sole publisher.
 */
import { z } from "zod";
import { applyDashboardBatch, readDashboardSource, DASHBOARD_LIMITS } from "@ai-chat/cloud-protocol/artifacts/design/dashboard/model";
import { DASHBOARD_DATA_LIMITS } from "@ai-chat/cloud-protocol/artifacts/design/dashboard/datasets";
import { designDigest } from "../documents/model";
import { dashboardAttachments } from "./attachments";
import { dashboardResources, prepareDashboardPage } from "./resources";
type Member = { path: string; data: Uint8Array };
const request = z.object({ writes: z.array(z.unknown()).max(50), attachments: z.array(z.object({ name: z.string().min(1).max(240), contentType: z.string().min(1).max(128), base64: z.string().max(12 * 1024 * 1024) }).strict()).max(1).optional(), deleteAssets: z.array(z.string().regex(/^[a-f0-9]{32}$/)).max(50).optional() }).strict();
export async function dashboardWrite(files: readonly Member[], raw: unknown, documentId: string) {
  const value = request.parse(raw), next = new Map(files.map(file => [file.path, file.data]));
  if (Buffer.byteLength(JSON.stringify(value.writes)) > DASHBOARD_LIMITS.batch) throw new Error("A Dashboard document batch exceeds 1 MiB");
  for (const asset of value.attachments ?? []) {
    const bytes = Buffer.from(asset.base64, "base64");
    if (!bytes.length || bytes.length > DASHBOARD_DATA_LIMITS.bytes || bytes.toString("base64") !== asset.base64) throw new Error("A Dashboard attachment must have 1 byte to 8 MiB of exact content");
    const id = designDigest(bytes).slice(7, 39); next.set("_blobs/" + id, bytes);
    next.set("_blobs/" + id + ".json", Buffer.from(JSON.stringify({ name: asset.name, contentType: asset.contentType, bytes: bytes.length }) + "\n"));
  }
  let result = [...next].map(([path, data]) => ({ path, data }));
  if (value.writes.length) result = applyDashboardBatch(result, value.writes, documentId);
  else if (!(value.attachments?.length || value.deleteAssets?.length)) throw new Error("The Dashboard batch is empty");
  if (value.deleteAssets?.length) {
    const source = readDashboardSource(result, documentId);
    for (const id of value.deleteAssets) {
      if (!source.blobs.has(id)) throw new Error("The Dashboard attachment no longer exists");
      if (Object.values(source.documents).some(doc => JSON.stringify(doc).includes(id))) throw new Error("Remove all source references before deleting this attachment");
      result = result.filter(file => file.path !== "_blobs/" + id && file.path !== "_blobs/" + id + ".json");
    }
  }
  await dashboardResources(result, documentId); return result;
}
export async function dashboardEditorMaterial(files: readonly Member[], documentId: string, runtime: ReadonlyMap<string, Uint8Array>) {
  const { source, pageBlobs } = await dashboardResources(files, documentId);
  return { title: source.manifest.title, attachments: dashboardAttachments(files, documentId), documents: source.documents, datasets: source.datasets,
    pageDigest: designDigest(JSON.stringify([source.sourceFiles, [...pageBlobs].sort().map(id => [id, designDigest(source.blobs.get(id)!)])])),
    html: (await prepareDashboardPage(files, documentId, runtime)).toString("utf8") };
}
