/**
 * [INPUT]: Depends on actual Chat/Base/Project/App Stores, verified Home ownership and published App source export.
 * [OUTPUT]: Builds a bounded content review before consent, excluding source-only image bytes from upload totals and reporting blocked App packages.
 * [POS]: Main-only read-only inventory; native paths and source bytes are never sent through the review IPC.
 */
import { inspectSkillFolder } from "../../../skills-management/package";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { baseAttachmentValueSchema } from "@ai-chat/base-ui/attachments/gallery-attachments";
import { canonicalJson, MAX_BLOB_BYTES } from "@ai-chat/cloud-protocol";
import { syncReviewSchema, type SyncReview } from "../../../../../shared/cloud/sync";
import type { CleanupOwners } from "../account/cleanup/plan";
import { exportPublishedAppSource } from "../apps/source";
import { scanHomeFiles } from "../../sync-home/scan";
export async function scanInitialSync(owners: CleanupOwners, userData: string, signal: AbortSignal): Promise<SyncReview> {
  signal.throwIfAborted();
  const inventory = await owners.chats.sync.read(null, { type: "local-inventory" });
  if (inventory.type !== "local-inventory") throw new Error("SYNC_INVENTORY_UNAVAILABLE");
  const review: SyncReview = { reviewId: randomUUID(), inspectedAt: Date.now(), native: inventory.value,
    bases: { count: 0, rows: 0, bytes: 0, images: 0, imageBytes: 0 }, projects: 0,
    homes: { count: 0, files: 0, bytes: 0, omitted: 0 }, apps: { count: 0, bytes: 0, blocked: [] } };
  const images = new Map<string, number>();
  const bases = owners.bases.listAll();
  if (bases.length > 10000 || owners.projects.list().length > 10000 || owners.apps.list().length > 1000) throw new Error("SYNC_INVENTORY_LIMIT");
  for (const { ownerKey, snapshot } of bases) {
    signal.throwIfAborted();
    const envelope = owners.bases.sync.read(ownerKey, snapshot.meta.ownerInstanceId);
    if (envelope.cloudState === "mirror" || envelope.initialIdentityRecovery || envelope.tombstones.includes("base")) continue;
    review.bases.count++; review.bases.rows += snapshot.rows.length;
    review.bases.bytes += Buffer.byteLength(canonicalJson({ meta: snapshot.meta, rows: snapshot.rows }));
    for (const row of snapshot.rows) for (const value of Object.values(row.values)) {
      const image = baseAttachmentValueSchema.safeParse(value); if (!image.success || image.data.localAvailability) continue;
      if (images.has(image.data.blobId) && images.get(image.data.blobId) !== image.data.byteLength) throw new Error("SYNC_ATTACHMENT_IDENTITY_CHANGED");
      images.set(image.data.blobId, image.data.byteLength);
    }
  }
  review.bases.images = images.size; review.bases.imageBytes = [...images.values()].reduce((sum, bytes) => sum + bytes, 0);
  review.projects = owners.projects.list().filter(project => !project.localRecoveryId && (!project.sync || project.sync.retention === "local")).length;
  for (const summary of owners.chats.list()) {
    signal.throwIfAborted();
    const chat = owners.chats.getMetadata(summary.id)!, home = owners.homes.ledger.get(chat.id);
    if (!home || chat.context.kind !== "ordinary" || chat.readOnlyReason === "external-readonly") continue;
    if (home.incarnationId !== chat.incarnationId || home.ownership !== "valid" || home.phase !== "committed") throw new Error("HOME_OWNERSHIP_UNAVAILABLE");
    await owners.homes.committedCreationEvidence(chat.id, home.intentId);
    const scanned = await scanHomeFiles(home.homeDir, home.worktree?.relativePath, signal);
    review.homes.count++; review.homes.files += scanned.files.length; review.homes.bytes += scanned.bytes; review.homes.omitted += scanned.omitted.length;
  }
  for (const app of owners.apps.list()) {
    signal.throwIfAborted();
    if (app.manifest?.kind !== "base") continue;
    review.apps.count++;
    const blocked = (reason: SyncReview["apps"]["blocked"][number]["reason"]) => { review.apps.blocked.push({ appId: app.id, name: app.displayName, reason }); };
    if (!app.generationBinding.active) { blocked("not-published"); continue; }
    const project = owners.projects.list().find(project => project.workspaceBinding.kind === "app" && project.workspaceBinding.appId === app.id);
    if (!project || !bases.some(base => base.ownerKey === `project:${project.id}`)) { blocked("association-unavailable"); continue; }
    try {
      const source = await exportPublishedAppSource(owners.apps, app.id, join(userData, "cloud-source-review"), signal);
      if (source.bytes.length > MAX_BLOB_BYTES) blocked("package-too-large"); else review.apps.bytes += source.bytes.length;
    } catch (error) {
      signal.throwIfAborted();
      const message = error instanceof Error ? error.message : "";
      blocked(message === "app-generation-changed" ? "generation-changed" : /budget|large|limit/i.test(message) ? "package-too-large" : "source-unavailable");
    }
  }
  review.skills = { count: 0, generations: 0, files: 0, bytes: 0 };
  for (const entry of owners.skills?.library.snapshot().entries ?? []) {
    if (entry.tombstoneAt !== null) continue;
    review.skills.count++;
    for (const generation of entry.generations) {
      signal.throwIfAborted();
      const path = owners.skills!.library.generationPath(entry.libraryId, generation.digest);
      const result = path ? await inspectSkillFolder(path) : null;
      if (!result?.importable) throw new Error("SKILL_GENERATION_UNAVAILABLE");
      review.skills.generations++; review.skills.files += result.skill.files.length; review.skills.bytes += result.skill.bytes;
    }
  }
  signal.throwIfAborted(); return syncReviewSchema.parse(review);
}
