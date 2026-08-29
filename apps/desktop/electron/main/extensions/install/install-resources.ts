/**
 * [INPUT]: Depends on Registry/lifecycle ledgers, Project install authority, content store, and PLUGIN_DATA epoch storage
 * [OUTPUT]: Provides install-side Project admission, epoch binding, content collection, and generation lookup operations
 * [POS]: Durable resource coordinator beneath ExtensionInstaller; source/admission policy remains in installer.ts
 */

import type {
  ExtensionPackageGenerationRef,
  PackageGenerationDataBinding,
  Sha256Digest,
} from "../../../../shared/extensions-ipc";
import type { ProductResourceScope } from "../../../../shared/product-resource-scope";
import type { ExtensionContentStore } from "../content-store";
import type { ExtensionRegistryStore } from "../registry-store";
import type {
  AuthorizedExtensionInstall,
  ExtensionLifecycleLedger,
  ExtensionLifecycleOperation,
} from "../lifecycle/lifecycle-ledger";
import type { PluginDataEpochStore } from "../lifecycle/plugin-data-epochs";

export type ExtensionInstallerFaults = Readonly<{
  beforeReservation?: (operationId: string) => void | Promise<void>;
  afterReserved?: (operationId: string) => void | Promise<void>;
  afterAuthorized?: (operationId: string) => void | Promise<void>;
  afterSealed?: (operationId: string) => void | Promise<void>;
  afterStagedContentRemoved?: (contentRoot: string) => void | Promise<void>;
  afterAppMigrated?: (operationId: string, appId: string) => void | Promise<void>;
}>;

export type ExtensionProjectInstallAuthority = Readonly<{
  acquire(input: ProjectAdmissionInput): Promise<void>;
  assert(input: ProjectAdmissionInput): void;
  release(input: ProjectAdmissionInput): Promise<void>;
}>;

type ProjectAdmissionInput = Readonly<{
  projectId: string;
  projectLifecycleRevision: number;
  operationId: string;
  installIdentity: string;
}>;

type InstallOwner = Readonly<{
  scope: ProductResourceScope;
  projectLifecycleRevision?: number | null;
  expectedProjectLifecycleRevision?: number | null;
  operationId: string;
  installIdentity: string;
}>;

export class ExtensionInstallResources {
  constructor(
    private readonly registry: ExtensionRegistryStore,
    private readonly ledger: ExtensionLifecycleLedger,
    private readonly epochs: PluginDataEpochStore,
    private readonly contentStore: ExtensionContentStore,
    private readonly faults: ExtensionInstallerFaults,
    private readonly projectAuthority: ExtensionProjectInstallAuthority
  ) {}

  async acquireProjectAdmission(input: InstallOwner) {
    if (input.scope.kind === "global") return;
    if (input.projectLifecycleRevision === null || input.projectLifecycleRevision === undefined) {
      throw conflict("Project install 缺少 lifecycle authority");
    }
    await this.projectAuthority.acquire({
      projectId: input.scope.projectId,
      projectLifecycleRevision: input.projectLifecycleRevision,
      operationId: input.operationId,
      installIdentity: input.installIdentity,
    });
  }

  assertProjectAdmission(operation: ExtensionLifecycleOperation) {
    if (operation.scope.kind === "global") return;
    if (operation.expectedProjectLifecycleRevision === null) {
      throw conflict("Project install 缺少 lifecycle authority");
    }
    this.projectAuthority.assert({
      projectId: operation.scope.projectId,
      projectLifecycleRevision: operation.expectedProjectLifecycleRevision,
      operationId: operation.operationId,
      installIdentity: operation.installIdentity,
    });
  }

  async releaseProjectAdmission(input: InstallOwner) {
    if (input.scope.kind === "global") return;
    const revision = input.expectedProjectLifecycleRevision ?? input.projectLifecycleRevision;
    if (revision === null || revision === undefined) return;
    await this.projectAuthority.release({
      projectId: input.scope.projectId,
      projectLifecycleRevision: revision,
      operationId: input.operationId,
      installIdentity: input.installIdentity,
    });
  }

  async bindData(
    operation: ExtensionLifecycleOperation,
    replay: AuthorizedExtensionInstall
  ): Promise<PackageGenerationDataBinding> {
    const epochId = operation.identities.pluginDataEpochId;
    if (!replay.admission.containsStdio || !epochId) return { kind: "none" };
    const sourceEpochId = operation.identities.sourceEpochId;
    if (!sourceEpochId) {
      await this.epochs.ensureEpoch(operation.installIdentity, epochId);
      return { kind: "stdio", pluginDataEpochId: epochId };
    }
    if (await this.epochs.hasEpoch(operation.installIdentity, epochId)) {
      return { kind: "stdio", pluginDataEpochId: epochId };
    }
    this.epochs.pauseWriters(operation.installIdentity, sourceEpochId);
    try {
      await this.epochs.snapshotEpoch({
        installIdentity: operation.installIdentity,
        fromEpochId: sourceEpochId,
        toEpochId: epochId,
      });
    } finally {
      this.epochs.resumeWriters(operation.installIdentity, sourceEpochId);
    }
    return { kind: "stdio", pluginDataEpochId: epochId };
  }

  async collectStagedContent(contentDigest: Sha256Digest | null) {
    if (!contentDigest) return;
    await this.contentStore.collect(
      this.retainedContentDigests(),
      (root) => this.faults.afterStagedContentRemoved?.(root)
    );
  }

  contentRoot(contentDigest: string) {
    return this.contentStore.contentRoot(contentDigest);
  }

  generationRef(packageGenerationId: string): ExtensionPackageGenerationRef | null {
    const found = this.registry.generationRecordById(packageGenerationId);
    return found
      ? { packageGenerationId: found.packageGenerationId, recordDigest: found.recordDigest }
      : null;
  }

  generationRecord(packageGenerationId: string) {
    return this.registry.generationRecordById(packageGenerationId);
  }

  retainedContentDigests() {
    return new Set<Sha256Digest>([
      ...this.registry.referencedContentDigests(),
      ...this.ledger
        .nonTerminal()
        .flatMap((item) => (item.contentDigest ? [item.contentDigest] : [])),
    ]);
  }
}

export const missingProjectInstallAuthority: ExtensionProjectInstallAuthority = {
  acquire: async () => {
    throw conflict("Project install authority 未装配");
  },
  assert: () => {
    throw conflict("Project install authority 未装配");
  },
  release: async () => undefined,
};

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}
