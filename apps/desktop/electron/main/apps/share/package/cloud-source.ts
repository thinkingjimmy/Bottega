/**
 * [INPUT]: Depends on AppStore active and durably captured generation custody, existing source freezing, shared portable paths and package verification.
 * [OUTPUT]: Exports verified generation or retained source bytes, fences removal on original publication custody and releases acknowledged source copies.
 * [POS]: Shared package kernel; it never reads the editable worktree or changes publishing state.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { encodeAppSourcePackage, isPortableAppSourcePath, verifyAppSourcePackage } from "@ai-chat/cloud-protocol/apps/source";
import { canonicalJson, hashBytes } from "@ai-chat/cloud-protocol";
import type { AppStore } from "../../store/app-store";
import { AppSourcePreparer } from "../../gui-build/pipeline/source-preparer";
import { verifyCompiledV3Artifact } from "../../gui-build/pipeline/seal";
import { inspectPackageDigests, verifyPackageArtifact } from "./package-contract";
import { generationDigests } from "../../generation/app-generation-plan";
import { sameScope, type SyncScope } from "../../../../../shared/local-storage/contracts";

type SourceStore = Pick<AppStore, "get" | "artifactRoot" | "retainArtifactRoot">;
export async function exportPublishedAppSource(apps: SourceStore, appId: string, stagingParent: string, signal?: AbortSignal) {
  return exportGeneration(apps, appId, null, stagingParent, signal);
}
export async function exportAppGenerationSource(apps: SourceStore, appId: string, generationId: string, stagingParent: string, signal?: AbortSignal) {
  return exportGeneration(apps, appId, generationId, stagingParent, signal);
}
export async function exportCapturedAppSource(apps: AppStore, scope: SyncScope, appId: string, stagingParent: string, signal?: AbortSignal) {
  const captured = apps.portable.publication.get(scope, appId);
  if (!captured?.source) throw new Error("APP_PUBLISHED_SOURCE_UNAVAILABLE");
  signal?.throwIfAborted();
  const bytes = await apps.sourceCustody.read(scope, appId, captured.source);
  if (bytes) {
    signal?.throwIfAborted();
    if (canonicalJson(apps.portable.publication.get(scope, appId)?.source) !== canonicalJson(captured.source)) throw new Error("APP_PUBLISHED_SOURCE_CHANGED");
    return { ...captured.source, appId, bytes };
  }
  return exportGeneration(apps, appId, captured.source.generationId, stagingParent, signal, () => {
    const current = apps.portable.publication.get(scope, appId);
    return current?.source?.generationId === captured.source!.generationId && current.source.sha256 === captured.source!.sha256;
  });
}
export async function retainCapturedAppSource(apps: AppStore, scope: SyncScope, appId: string, stagingParent: string, removal?: { generationId: string; bindingRevision: number }) {
  // Cleanup closes enrollment before recovery; only the original journal may retain its already captured source.
  const current = () => apps.portable.publication.list(scope).find(item => item.operation.appId === appId);
  let plan = current();
  if (plan && (!plan.source || removal && plan.state === "complete" && plan.source.generationId !== removal.generationId)) {
    if (!removal) throw new Error("APP_REMOVAL_SOURCE_UNCAPTURED");
    const operationId = plan.operation.operationId;
    const { appId: _appId, bytes, ...source } = await exportGeneration(apps, appId, removal.generationId, stagingParent, undefined,
      () => current()?.operation.operationId === operationId);
    plan = await apps.portable.publication.captureRemovalSource(scope, appId, { ...source, bytes: bytes.length }, removal);
  }
  if (!plan?.source || plan.state === "complete") return;
  if (await apps.sourceCustody.read(scope, appId, plan.source)) return;
  const exported = await exportGeneration(apps, appId, plan.source.generationId, stagingParent, undefined,
    () => canonicalJson(current()?.source) === canonicalJson(plan!.source));
  if (current()?.state !== "complete") await apps.sourceCustody.retain(scope, appId, plan.source, exported.bytes);
}
export async function releaseCompletedAppSource(apps: AppStore, scope: SyncScope, appId: string) {
  await apps.portable.publication.releaseCompletedSource(scope, appId, async plan => {
    const ciphertext = plan.packageBlob && plan.packageOperationId ? { descriptor: plan.packageBlob,
      key: hashBytes(new TextEncoder().encode(canonicalJson(["app-file", plan.packageOperationId]))) } : undefined;
    await apps.sourceCustody.release(scope, appId, plan.source!, ciphertext);
  });
}
export async function assertCapturedAppSourceRetained(apps: AppStore, appId: string) {
  const entry = apps.portable.get(appId);
  for (const plan of apps.portable.publication.list()) {
    if (plan.operation.appId === appId && plan.scope && plan.state !== "complete" &&
      (plan.source ? !await apps.sourceCustody.read(plan.scope, appId, plan.source) :
        !(entry?.tombstoned && sameScope(entry.scope, plan.scope)))) throw new Error("APP_PUBLICATION_RETENTION_REQUIRED");
  }
}
async function exportGeneration(apps: SourceStore, appId: string, selectedGeneration: string | null, stagingParent: string, signal?: AbortSignal, retained?: () => boolean) {
  signal?.throwIfAborted();
  const record = apps.get(appId), active = record?.generationBinding.active;
  const generation = record?.generations.find(item => item.generationId === (selectedGeneration ?? active?.generationId));
  if (!record || !generation || generation.manifest.kind !== "base") throw new Error("app-published-base-required");
  const selected = (value: typeof record) => retained ? retained() : selectedGeneration ?
    [value.generationBinding.pending?.generationId, value.generationBinding.active?.generationId].includes(selectedGeneration) :
    value.generationBinding.active?.generationId === generation.generationId;
  if (!selected(record)) throw new Error("app-generation-unbound");
  const release = apps.retainArtifactRoot(appId, generation.generationId);
  const preparer = new AppSourcePreparer();
  let frozen: Awaited<ReturnType<AppSourcePreparer["freeze"]>> | undefined;
  const current = () => {
    signal?.throwIfAborted();
    const next = apps.get(appId);
    if (!next || !selected(next) || !retained && next.generationBinding.bindingRevision !== record.generationBinding.bindingRevision) throw new Error("app-generation-changed");
  };
  try {
    current();
    const artifactRoot = apps.artifactRoot(appId, generation.generationId);
    const expected = generationDigests(generation);
    if (generation.contentLayoutVersion === 3) {
      if (!generation.buildReceiptDigest) throw new Error("app-build-receipt-missing");
      await verifyCompiledV3Artifact(artifactRoot, { ...expected, buildReceiptDigest: generation.buildReceiptDigest });
    } else await verifyPackageArtifact({ root: artifactRoot, manifest: generation.manifest, expected });
    frozen = await preparer.freeze({ appId, liveRoot: join(artifactRoot, "source"), stagingParent, compiled: generation.contentLayoutVersion === 3 });
    // Verify the copied bytes, so a source mutation followed by restoration cannot pass a second path-only check.
    if (generation.contentLayoutVersion === 3) {
      if (frozen.sourcePackageDigest !== generation.sourcePackageDigest) throw new Error("app-source-generation-mismatch");
    } else {
      const actual = await inspectPackageDigests(frozen.snapshotRoot, generation.manifest);
      for (const key of ["manifestDigest", "sourcePackageDigest", "contentDigest"] as const) {
        if (actual[key] !== expected[key]) throw new Error("app-source-generation-mismatch");
      }
    }
    const files = [];
    for (const file of frozen.files) {
      signal?.throwIfAborted();
      if (!isPortableAppSourcePath(file.path)) continue;
      const bytes = await readFile(join(frozen.snapshotRoot, file.path));
      if (bytes.byteLength !== file.bytes || "sha256:" + hashBytes(bytes) !== file.sha256) throw new Error("app-frozen-source-changed");
      files.push({ path: file.path, bytes });
    }
    const bytes = encodeAppSourcePackage(files, generation.sourcePackageDigest.slice("sha256:".length));
    const { files: _files, manifest: _manifest, ...verified } = verifyAppSourcePackage(bytes);
    current();
    return { appId, generationId: generation.generationId, bytes, sha256: hashBytes(bytes), ...verified };
  } finally {
    try { if (frozen) await preparer.discard(frozen); }
    finally { release(); }
  }
}
