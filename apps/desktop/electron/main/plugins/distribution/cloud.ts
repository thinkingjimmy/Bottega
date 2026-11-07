/**
 * [INPUT]: Depends on the existing account-owned encrypted Widget package transport and the single complete-package receiver.
 * [OUTPUT]: Provides explicit remote review/acceptance, account-bound progress/cancellation and full accepted-package publication.
 * [POS]: Unified plugin Cloud adapter; discovery changes available metadata while accepted code and instance data remain unchanged.
 */
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pluginUpdateAcceptSchema, pluginUpdateQuerySchema, type PluginUpdateReview, type PluginUpdateProgress } from "@bottega/contracts/plugins/platform";
import type { WidgetCloudPort } from "../../cloud/widgets/ports";
import type { WidgetPackageDelivery } from "@ai-chat/cloud-protocol/widgets/model";
import { freezeCloudPluginPacket, verifyCloudPluginArchive } from "../../cloud/widgets/plugins/codec";
import type { UnifiedPluginPlatform } from "../platform/service";
import { receiveUnifiedPluginDistribution } from "./receiver";
import { PluginSharingConsent } from "./sharing";
type Review = { epoch: number; value: PluginUpdateReview; delivery: WidgetPackageDelivery; expiresAt: number };
export type PluginPublication = { status: "shared"; reference: string; revisionId: string } | { status: "skipped"; reason: "signed-out" | "unshared" | "already-published" | "offline"; revisionId?: string };
type Operation = { reviewId: string; controller: AbortController; progress: PluginUpdateProgress; promise: Promise<PluginUpdateProgress> };
export class PluginCloudPackages {
  private readonly reviews = new Map<string, Review>();
  private readonly operations = new Map<string, Operation>();
  private readonly retired = new Set<Promise<unknown>>();
  private readonly sharing: PluginSharingConsent;
  private readonly publications = new Map<string, Promise<PluginPublication>>();
  private readonly stop = new AbortController();
  private account = new AbortController();
  private epoch = 0;
  constructor(private readonly ports: { userData: string; platform: UnifiedPluginPlatform; cloud(): WidgetCloudPort | null; accountId(): string | null }) { this.sharing = new PluginSharingConsent(ports.userData); }
  initialize() { return this.sharing.initialize(); }
  private cloud() { const cloud = this.ports.cloud(); if (!cloud?.available() || !cloud.reviewPlugin || !cloud.downloadPlugin || !cloud.publishPlugin) throw new Error("Plugin package delivery is unavailable while offline or signed out"); return cloud; }
  accountChanged() {
    this.epoch += 1; this.account.abort(new Error("Plugin package account changed")); this.account = new AbortController();
    this.reviews.clear(); for (const operation of this.operations.values()) { operation.controller.abort(new Error("Plugin package account changed")); this.retired.add(operation.promise); void operation.promise.finally(() => this.retired.delete(operation.promise)); } this.operations.clear();
  }
  private authority(epoch = this.epoch) {
    const signal = AbortSignal.any([this.stop.signal, this.account.signal]);
    const assertCurrent = () => { if (epoch !== this.epoch) throw new Error("Plugin package account changed"); signal.throwIfAborted(); };
    assertCurrent(); return { epoch, signal, assertCurrent };
  }
  async refresh() {
    const authority = this.authority(), cloud = this.cloud(); let cursor: string | null = null;
    do {
      const page = await cloud.catalog(cursor, authority.signal);
      authority.assertCurrent();
      for (const entry of page.page) if (entry.state === "active" && entry.latest?.format === "bottega-plugin/v1") {
        const checked = await cloud.reviewPlugin!({ subject: entry.subject, reference: entry.latest.reference }, authority.signal);
        authority.assertCurrent();
        await this.ports.platform.noteAvailablePackage({ manifest: checked.manifest, revisionId: checked.distribution.revisionId,
          packageDirectory: join(this.ports.userData, "plugin-packages", checked.manifest.id) }, authority.assertCurrent);
        authority.assertCurrent();
      }
      cursor = page.isDone ? null : page.continueCursor;
    } while (cursor);
  }
  async review(raw: unknown): Promise<PluginUpdateReview> {
    const input = pluginUpdateQuerySchema.parse(raw), authority = this.authority(), cloud = this.cloud(); let cursor: string | null = null, chosen: WidgetPackageDelivery | undefined;
    do {
      const page = await cloud.catalog(cursor, authority.signal);
      authority.assertCurrent();
      const candidates = page.page.flatMap(entry => entry.state === "active" && entry.subject.definitionId === input.pluginId && (!input.sourceInstallationId || entry.subject.sourceInstallationId === input.sourceInstallationId) && entry.latest?.format === "bottega-plugin/v1" && (!input.reference || entry.latest.reference === input.reference) ? [entry.latest] : []);
      for (const candidate of candidates) if (!chosen || candidate.updatedAt > chosen.updatedAt) chosen = candidate;
      cursor = page.isDone ? null : page.continueCursor;
    } while (cursor);
    if (!chosen) throw new Error("No complete plugin package is available for review");
    const checked = await cloud.reviewPlugin!({ subject: chosen.subject, reference: chosen.reference }, authority.signal);
    authority.assertCurrent();
    if (checked.distribution.target.platform !== process.platform || checked.distribution.target.arch !== process.arch || checked.distribution.target.nodeMajor !== 24) throw new Error("This plugin package targets a different computer runtime");
    const value: PluginUpdateReview = { reviewId: randomUUID(), pluginId: checked.manifest.id, name: checked.manifest.name, revisionId: checked.distribution.revisionId,
      reference: chosen.reference, sourceInstallationId: chosen.subject.sourceInstallationId, bytes: chosen.archiveBytes,
      contributions: checked.manifest.contributions.map(({ id, kind, name }) => ({ id, kind, name })), trustRequired: !this.ports.platform.get(input.pluginId)?.installation.trustAcceptedAt };
    for (const [id, review] of this.reviews) if (review.expiresAt <= Date.now()) this.reviews.delete(id);
    if (this.reviews.size >= 16) throw new Error("Plugin review capacity reached");
    this.reviews.set(value.reviewId, { epoch: authority.epoch, value, delivery: chosen, expiresAt: Date.now() + 600_000 }); return value;
  }
  dismiss(reviewId: string) { this.reviews.delete(reviewId); }
  progress(operationId: string) { const value = this.operations.get(operationId)?.progress; return value ? structuredClone(value) : null; }
  accept(raw: unknown) {
    const input = pluginUpdateAcceptSchema.parse(raw), existing = this.operations.get(input.operationId);
    if (existing) { if (existing.reviewId !== input.reviewId) throw new Error("Plugin update operation identity conflict"); return existing.promise; }
    const review = this.reviews.get(input.reviewId);
    if (!review || review.expiresAt <= Date.now() || review.epoch !== this.epoch) throw new Error("Plugin update review expired; review the exact package again");
    const controller = new AbortController(), operation: Operation = { reviewId: input.reviewId, controller,
      progress: { operationId: input.operationId, pluginId: review.value.pluginId, revisionId: review.value.revisionId, state: "downloading", bytes: 0, totalBytes: review.value.bytes }, promise: Promise.resolve(null as never) };
    this.operations.set(input.operationId, operation);
    operation.promise = this.install(review, operation); return operation.promise;
  }
  private async install(review: Review, operation: Operation) {
    const authority = this.authority(review.epoch), signal = AbortSignal.any([authority.signal, operation.controller.signal]);
    const assertCurrent = () => { authority.assertCurrent(); signal.throwIfAborted(); }; let directory: string | undefined;
    try {
      const bytes = await this.cloud().downloadPlugin!(review.delivery, signal, value => { operation.progress = { ...operation.progress, bytes: value.bytes, totalBytes: review.value.bytes }; });
      assertCurrent(); const packet = verifyCloudPluginArchive(bytes, review.value.reference);
      const root = join(this.ports.userData, "plugin-receive"); await mkdir(root, { recursive: true, mode: 0o700 }); directory = await mkdtemp(join(root, ".receive-"));
      for (const [path, content] of packet.files) { signal.throwIfAborted(); const target = join(directory, path); await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, content, { mode: 0o400 }); }
      assertCurrent(); operation.progress.state = "installing";
      assertCurrent();
      await receiveUnifiedPluginDistribution(this.ports.platform, this.ports.userData, { directory, trust: true, expectedManifestDigest: packet.distribution.manifestDigest }, { signal, assertCurrent, operationId: operation.progress.operationId });
      assertCurrent();
      operation.progress = { ...operation.progress, state: "ready", bytes: review.value.bytes };
      this.reviews.delete(review.value.reviewId);
    } catch (cause) { operation.progress = { ...operation.progress, state: signal.aborted ? "cancelled" : "failed", error: String((cause as Error).message).slice(0, 2048) }; }
    finally { if (directory) await rm(directory, { recursive: true, force: true }); }
    return structuredClone(operation.progress);
  }
  async cancel(operationId: string) { const operation = this.operations.get(operationId); if (!operation) throw new Error("Plugin update operation is unavailable"); operation.controller.abort(); return operation.promise; }
  async sharingStatus(pluginId: string) {
    const authority = this.authority(), accountId = this.ports.accountId();
    if (!accountId) return { enabled: false };
    const consent = await this.sharing.get(accountId, pluginId); authority.assertCurrent();
    if (accountId !== this.ports.accountId()) throw new Error("Plugin package account changed");
    return { enabled: Boolean(consent), ...(consent ? { lastPublishedRevision: consent.lastPublishedRevision } : {}) };
  }
  async publish(pluginId: string) {
    const result = await this.publishOwned(pluginId, true);
    if (result.status !== "shared") throw new Error("Plugin sharing requires a signed-in account and an available encrypted Cloud connection");
    return { reference: result.reference, revisionId: result.revisionId };
  }
  publishUpdates(pluginId: string) { return this.publishOwned(pluginId, false); }
  private publishOwned(pluginId: string, explicit: boolean): Promise<PluginPublication> {
    const authority = this.authority(), accountId = this.ports.accountId();
    if (!accountId) return Promise.resolve({ status: "skipped", reason: "signed-out" });
    const assertCurrent = () => { authority.assertCurrent(); if (accountId !== this.ports.accountId()) throw new Error("Plugin package account changed"); };
    const key = JSON.stringify([accountId, pluginId]), previous = this.publications.get(key) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(async (): Promise<PluginPublication> => {
      assertCurrent(); const consent = await this.sharing.get(accountId, pluginId); assertCurrent();
      if (!explicit && !consent) return { status: "skipped", reason: "unshared" };
      const revision = this.ports.platform.activeRevision(pluginId);
      if (!revision || !this.ports.platform.isActive(pluginId, revision.revisionId)) throw new Error("Plugin has no accepted active package");
      if (!explicit && consent?.lastPublishedRevision === revision.revisionId) return { status: "skipped", reason: "already-published", revisionId: revision.revisionId };
      if (!explicit && !this.ports.cloud()?.available()) return { status: "skipped", reason: "offline", revisionId: revision.revisionId };
      const cloud = this.cloud(), packet = await freezeCloudPluginPacket(revision.rootDirectory); assertCurrent();
      await cloud.publishPlugin!(packet, authority.signal); assertCurrent();
      await this.sharing.published({ accountId, pluginId, revisionId: revision.revisionId, explicit }, assertCurrent);
      return { status: "shared", reference: packet.reference, revisionId: revision.revisionId };
    });
    this.publications.set(key, task);
    void task.then(() => { if (this.publications.get(key) === task) this.publications.delete(key); }, () => { if (this.publications.get(key) === task) this.publications.delete(key); });
    return task;
  }
  async close() { this.stop.abort(); await Promise.allSettled([...this.retired, ...this.publications.values(), ...[...this.operations.values()].map(value => value.promise)]); this.reviews.clear(); await this.sharing.close(); }
}
