/**
 * [INPUT]: Depends on the AppStore queue, verified installed source baselines and original authenticated service receipts.
 * [OUTPUT]: Captures source changes against their acknowledged version, preserves stale candidates and fences installation checkpoints to their local generation.
 * [POS]: AppStore publication collaborator; it shares apps.json and never creates a second outbox.
 */
import { canonicalJson, hashBytes } from "@ai-chat/cloud-protocol";
import { sameScope, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { appDescriptorSchema, appPortableCatalogSchema, type AppDescriptor } from "./model";
import { appPublicationSchema, type AppPublication, type AppPublicationBaseline } from "./publication-model";
import type { AppPortablePorts } from "./api";
import type { FrozenAppOperation } from "@ai-chat/cloud-protocol/apps/encrypted";
import { verifyFrozenAppOperation } from "@ai-chat/cloud-protocol/apps/encrypted/client";
import { randomUUID } from "node:crypto";
const receiptBaseline = (plan: AppPublication): AppPublicationBaseline | null => plan.source && plan.publishReceipt &&
  ["applied", "converged"].includes(plan.publishReceipt.outcome) && plan.publishReceipt.packageRevision !== null ? {
    revision: plan.publishReceipt.revision, packageRevision: plan.publishReceipt.packageRevision,
    manifestDigest: plan.source.manifestDigest, sourcePackageDigest: plan.source.sourcePackageDigest,
  } : null;
const initialBaseline = (plan: Pick<AppPublication, "createReceipt" | "promotion">): AppPublicationBaseline | null => {
  const revision = plan.createReceipt?.revision ?? (plan.promotion ? 1 : null);
  return revision === null ? null : { revision, packageRevision: 0, manifestDigest: null, sourcePackageDigest: null };
};
export class AppPublicationApi {
  constructor(private readonly ports: AppPortablePorts, private readonly assertScope: (scope: SyncScope, closing?: boolean) => void) {}
  list(scope?: SyncScope) { return structuredClone(this.ports.state().publications.filter(item => !scope || sameScope(item.scope, scope))); }
  get(scope: SyncScope, appId: string) { this.assertScope(scope); return this.list(scope).find(item => item.operation.appId === appId) ?? null; }
  roots() { return this.ports.state().publications.filter(item => item.state !== "complete" && item.source).map(item => ({ appId: item.operation.appId, generationId: item.source!.generationId })); }
  capture(input: Pick<AppPublication, "manifestId" | "operation" | "source" | "promotion" | "association"> & { scope: SyncScope }) {
    return this.ports.enqueue(async () => {
      this.assertScope(input.scope);
      const state = this.ports.state(), previous = state.publications.find(item => item.operation.appId === input.operation.appId && sameScope(item.scope, input.scope));
      if (previous) {
        if (!sameScope(previous.scope, input.scope)) throw new Error("APP_SYNC_SCOPE_UNAVAILABLE");
        if (canonicalJson(previous.promotion ?? null) !== canonicalJson(input.promotion ?? null)) throw new Error("APP_PROMOTION_CHANGED");
        if (canonicalJson(previous.association ?? null) !== canonicalJson(input.association ?? null)) throw new Error("APP_ASSOCIATION_CHANGED");
        return structuredClone(previous);
      }
      const installed = this.ports.installed(input.operation.appId);
      if (!installed || installed.manifest?.kind !== "base" || input.source &&
        installed.generationBinding.active?.generationId !== input.source.generationId) throw new Error("APP_PUBLISHED_SOURCE_CHANGED");
      if (input.association) {
        const entry = state.entries.find(item => item.descriptor.appId === input.operation.appId), proof = input.association;
        if (!entry || entry.tombstoned || !sameScope(entry.scope, input.scope) || entry.descriptor.projectId !== proof.projectId ||
          entry.descriptor.baseId !== proof.baseId || entry.descriptor.cloudRevision > proof.revision) throw new Error("APP_ASSOCIATION_CHANGED");
      }
      const baseline = input.association ? state.entries.find(item => item.descriptor.appId === input.operation.appId)!.installedPublication : null;
      if (input.association && !baseline) throw new Error("APP_PUBLICATION_BASELINE_UNAVAILABLE");
      const publication = appPublicationSchema.parse({ ...input, baseline: baseline ?? initialBaseline({ createReceipt: null, promotion: input.promotion }), createReceipt: null, packageBlob: null, candidate: null,
        publishReceipt: null, attempts: 0, state: "pending" });
      await this.ports.commit(appPortableCatalogSchema.parse({ ...state, publications: [...state.publications, publication] }));
      return structuredClone(publication);
    });
  }
  source(scope: SyncScope, appId: string, input: NonNullable<AppPublication["source"]>) {
    return this.setSource(scope, appId, input);
  }
  captureRemovalSource(scope: SyncScope, appId: string, input: NonNullable<AppPublication["source"]>, baseline: { generationId: string; bindingRevision: number }) {
    return this.setSource(scope, appId, input, baseline);
  }
  private setSource(scope: SyncScope, appId: string, input: NonNullable<AppPublication["source"]>, removal?: { generationId: string; bindingRevision: number }) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope, Boolean(removal)); const state = structuredClone(this.ports.state());
      const current = state.publications.find(item => item.operation.appId === appId && sameScope(item.scope, scope));
      const installed = this.ports.installed(appId);
      const bound = removal ? installed?.state === "deleting" && installed.generationBinding.active === null &&
        installed.generationBinding.bindingRevision === removal.bindingRevision + 1 && input.generationId === removal.generationId &&
        installed.generations.some(generation => generation.generationId === removal.generationId) : installed?.generationBinding.active?.generationId === input.generationId;
      if (!current || !bound) throw new Error("APP_PUBLISHED_SOURCE_CHANGED");
      if (current.source && current.state === "pending") {
        if (canonicalJson(current.source) !== canonicalJson(input)) throw new Error("APP_PUBLICATION_STILL_PENDING"); return structuredClone(current);
      }
      const entry = state.entries.find(item => item.descriptor.appId === appId);
      const acknowledged = [receiptBaseline(current), entry?.installedPublication].filter((value): value is AppPublicationBaseline => Boolean(value))
        .sort((a, b) => b.revision - a.revision)[0];
      const baseline = acknowledged ?? current.baseline ?? initialBaseline(current);
      if (!baseline) throw new Error("APP_PUBLICATION_BASELINE_UNAVAILABLE");
      const sameContent = baseline.sourcePackageDigest === input.sourcePackageDigest && baseline.manifestDigest === input.manifestDigest;
      current.source = appPublicationSchema.shape.source.unwrap().parse(input);
      current.baseline = baseline;
      current.packageBlob = null; current.candidate = null; current.encryptedCandidate = null; current.packageOperationId = randomUUID();
      current.publishReceipt = null; current.attempts = 0; current.state = sameContent ? "complete" : "pending";
      if (sameContent) {
        if (entry && installed?.generationBinding.active?.generationId === input.generationId) {
          entry.installedGenerationId = input.generationId; entry.installedPackageRevision = baseline.packageRevision; entry.installedPublication = baseline;
        }
      }
      await this.ports.commit(appPortableCatalogSchema.parse(state)); return structuredClone(current);
    });
  }
  freezeCiphertext(scope: SyncScope, appId: string, input: FrozenAppOperation) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope); const state = structuredClone(this.ports.state()), current = state.publications.find(item => item.operation.appId === appId && sameScope(item.scope, scope));
      if (!current) throw new Error("APP_PUBLICATION_UNAVAILABLE");
      const create = input.transport.intent.kind === "create", original = create ? current.operation : current.candidate;
      if (!original) throw new Error("APP_CANDIDATE_CHANGED");
      const value = verifyFrozenAppOperation(input, original), previous = create ? current.encryptedCreate : current.encryptedCandidate;
      if (previous) {
        if (previous.plaintextHash !== value.plaintextHash || canonicalJson(previous.encryptedSpace) !== canonicalJson(value.encryptedSpace)) throw new Error("APP_CIPHERTEXT_CHANGED");
        return structuredClone(previous);
      }
      if (create ? current.createReceipt || current.association || current.promotion : current.publishReceipt) throw new Error("APP_CIPHERTEXT_CHANGED");
      if (create) current.encryptedCreate = value; else current.encryptedCandidate = value;
      await this.ports.commit(appPortableCatalogSchema.parse(state)); return structuredClone(value);
    });
  }
  packageIdentity(scope: SyncScope, appId: string) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope); const state = structuredClone(this.ports.state());
      const current = state.publications.find(item => item.operation.appId === appId && sameScope(item.scope, scope));
      if (!current?.source || !current.baseline || current.state !== "pending") throw new Error("APP_PUBLICATION_UNAVAILABLE");
      if (!current.packageOperationId) {
        if (current.candidate || current.attempts) throw new Error("APP_CIPHERTEXT_REQUIRED");
        current.packageOperationId = randomUUID(); await this.ports.commit(appPortableCatalogSchema.parse(state));
      }
      return structuredClone(current);
    });
  }
  releaseCompletedSource<T>(scope: SyncScope, appId: string, release: (plan: AppPublication) => Promise<T>) {
    return this.ports.enqueue(async () => {
      const current = this.ports.state().publications.find(item => item.operation.appId === appId && sameScope(item.scope, scope));
      if (!current?.source || current.state !== "complete") return;
      return release(structuredClone(current));
    });
  }
  withFrozenSource<T>(scope: SyncScope, appId: string, sourceHash: string, operation: () => Promise<T>) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope);
      const current = this.ports.state().publications.find(item => item.operation.appId === appId && sameScope(item.scope, scope));
      if (current?.source?.sha256 !== sourceHash || current.state !== "pending") throw new Error("APP_PUBLISHED_SOURCE_CHANGED");
      return operation();
    });
  }
  checkpoint(scope: SyncScope, appId: string, value: Partial<Pick<AppPublication, "createReceipt" | "packageBlob" | "candidate" | "publishReceipt">>, descriptor?: AppDescriptor) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope); const state = structuredClone(this.ports.state()), current = state.publications.find(item => item.operation.appId === appId && sameScope(item.scope, scope));
      if (!current || !sameScope(current.scope, scope)) throw new Error("APP_PUBLICATION_UNAVAILABLE");
      for (const [key, next] of Object.entries(value)) {
        const previous = current[key as keyof typeof value];
        if (previous && canonicalJson(previous) !== canonicalJson(next)) throw new Error("APP_PUBLICATION_CHECKPOINT_CHANGED");
      }
      Object.assign(current, value);
      if (current.createReceipt) {
        const receipt = current.createReceipt, operation = current.operation;
        if (receipt.kind !== "create" || receipt.operationId !== operation.operationId || receipt.appId !== appId || receipt.projectId !== operation.projectId || receipt.baseId !== operation.baseId ||
          receipt.payloadHash !== hashBytes(new TextEncoder().encode(canonicalJson(operation))) || !["applied", "converged"].includes(receipt.outcome)) throw new Error("APP_CREATION_RECEIPT_CHANGED");
        current.baseline ??= initialBaseline(current);
      }
      if (current.packageBlob && (!current.source || current.packageBlob.sha256 !== current.source.sha256 || current.packageBlob.bytes !== current.source.bytes)) throw new Error("APP_SOURCE_RECEIPT_CHANGED");
      if (current.candidate && (!current.packageBlob || !current.baseline || current.candidate.expectedRevision !== current.baseline.revision ||
        current.candidate.packageRevision !== current.baseline.packageRevision + 1 || current.candidate.appId !== appId ||
        canonicalJson(current.candidate.packageBlob) !== canonicalJson(current.packageBlob))) throw new Error("APP_CANDIDATE_CHANGED");
      if (current.publishReceipt) {
        if (!current.candidate || current.publishReceipt.kind !== "publish" || current.publishReceipt.projectId !== current.operation.projectId ||
          current.publishReceipt.baseId !== current.operation.baseId || current.publishReceipt.appId !== appId || current.publishReceipt.operationId !== current.candidate.operationId ||
          current.publishReceipt.payloadHash !== hashBytes(new TextEncoder().encode(canonicalJson(current.candidate)))) throw new Error("APP_PACKAGE_RECEIPT_CHANGED");
        current.state = ["applied", "converged"].includes(current.publishReceipt.outcome) ? "complete" : "blocked";
        if (current.state === "complete" && current.publishReceipt.packageRevision !== current.candidate.packageRevision) throw new Error("APP_PACKAGE_RECEIPT_CHANGED");
      }
      if (descriptor) {
        const next = appDescriptorSchema.parse(descriptor);
        if (next.appId !== appId || next.projectId !== current.operation.projectId || next.baseId !== current.operation.baseId ||
          !current.createReceipt && !current.promotion && !current.association) throw new Error("APP_ASSOCIATION_CHANGED");
        const existing = state.entries.find(entry => entry.descriptor.appId === appId);
        if (existing && (existing.scope && !sameScope(existing.scope, scope) || existing.scope && existing.descriptor.cloudRevision > next.cloudRevision ||
          !existing.scope && !this.ports.installed(appId))) throw new Error("APP_ASSOCIATION_CHANGED");
        if (existing) { existing.scope = scope; existing.descriptor = next;
          if (current.promotion && this.ports.installed(appId)) existing.installation = "installed";
        }
        else state.entries.push({ scope, descriptor: next, installation: this.ports.installed(appId) ? "installed" : "not-installed", installedGenerationId: null,
          installedPackageRevision: null, installedPublication: null, tombstoned: false });
        if (current.state === "complete" && current.publishReceipt) {
          const entry = state.entries.find(item => item.descriptor.appId === appId)!;
          if (next.packageRevision === current.publishReceipt!.packageRevision && (next.sourcePackageDigest !== current.source!.sourcePackageDigest ||
            next.manifestDigest !== current.source!.manifestDigest || !next.sourceBlob || canonicalJson(next.sourceBlob) !== canonicalJson(current.packageBlob))) throw new Error("APP_SOURCE_RECEIPT_CHANGED");
          if (this.ports.installed(appId)?.generationBinding.active?.generationId === current.source!.generationId) {
            entry.installedGenerationId = current.source!.generationId; entry.installedPackageRevision = current.publishReceipt!.packageRevision;
            entry.installedPublication = receiptBaseline(current);
          }
        }
      }
      await this.ports.commit(appPortableCatalogSchema.parse(state)); return structuredClone(current);
    });
  }
  conflict(scope: SyncScope, appId: string, sourceHash: string, revision: number) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope); const state = structuredClone(this.ports.state());
      const current = state.publications.find(item => item.operation.appId === appId && sameScope(item.scope, scope));
      if (!current?.baseline || current.source?.sha256 !== sourceHash || current.publishReceipt || !Number.isSafeInteger(revision) ||
        revision <= current.baseline.revision) throw new Error("APP_PUBLICATION_BASELINE_CHANGED");
      current.state = "blocked";
      await this.ports.commit(appPortableCatalogSchema.parse(state)); return structuredClone(current);
    });
  }
  attempt(scope: SyncScope, appId: string) {
    return this.ports.enqueue(async () => { this.assertScope(scope); const state = structuredClone(this.ports.state());
      const current = state.publications.find(item => item.operation.appId === appId && sameScope(item.scope, scope));
      if (!current) throw new Error("APP_PUBLICATION_UNAVAILABLE"); current.attempts++;
      await this.ports.commit(appPortableCatalogSchema.parse(state)); return current.attempts; });
  }
}
