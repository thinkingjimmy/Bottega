/**
 * [INPUT]: Depends on Apps lifecycle/usage/gateway gate, installer/runtime, generation/data/preferences/archive ledgers, Extension participant and non-main cleanup ports
 * [OUTPUT]: Provides AppDeleteCoordinator for admission closure, capability withdrawal, build abort, data/preferences disposition, drain evidence, and silent shell cleanup
 * [POS]: apps/service deletion side-effect executor; renderer removal publication belongs to the enclosing saga after every domain finalizer commits
 */

import { join } from "node:path";
import type { AppRecord, RemoveAppMode } from "../../../../shared/apps-ipc";
import type {
  AppGenerationBuildCheckpoint,
  AppGenerationBuildOperation,
} from "../../../../shared/app-lifecycle";
import type { AppExtensionIntegration } from "../../extensions/integration/app-extension-composition";
import type { AppGenerationBuildParticipantRegistry } from "../../lifecycle/app-generation-build-participants";
import type {
  AppLifecycleAdmissionGate,
  AppUsageRegistry,
} from "../../lifecycle/app-platform-admission";
import { cleanupAppFiles } from "../app-cleanup";
import type { AppDataArchiveStore } from "../app-data-archive";
import type { AppDataCutoverLedger } from "../app-data-cutover-ledger";
import type { AppGenerationBuildLedger } from "../app-generation-build-ledger";
import type { AppGateway } from "../app-gateway";
import type { AppInstaller } from "../app-installer";
import type { AppProcessCustodyJournal } from "../process-custody-journal";
import type { AppReferenceJournal } from "../app-reference-journal";
import type { AppRuntime } from "../app-runtime";
import type { AppServerDataCutover } from "../app-server-cutover";
import type { AppStore } from "../app-store";
import type { AppGrantAuthority } from "../attachments/grant-authority";
import type { AppManagementLeaseRegistry } from "../attachments/management-leases";
import type { AppAttachmentSurfaceLeaseRegistry } from "../attachments/surface-leases";
import { appDigest } from "./digest";

type AppDeleteCoordinatorDependencies = {
  userData: string;
  store: AppStore;
  installer: AppInstaller;
  runtime: AppRuntime;
  lifecycleGate: AppLifecycleAdmissionGate;
  usageRegistry: AppUsageRegistry;
  gatewayRequestLeases: AppGateway["requestLeases"];
  buildLedger: AppGenerationBuildLedger;
  referenceJournal: AppReferenceJournal;
  processCustody: AppProcessCustodyJournal;
  dataCutovers: AppDataCutoverLedger;
  dataArchives: AppDataArchiveStore;
  serverCutover: AppServerDataCutover;
  surfaceLeases(): AppAttachmentSurfaceLeaseRegistry | null;
  managementLeases(): AppManagementLeaseRegistry | null;
  grantAuthority(): AppGrantAuthority | null;
  extensions(): AppExtensionIntegration | null;
  buildParticipants(): AppGenerationBuildParticipantRegistry | null;
  stop(appId: string): Promise<void>;
  closeGuiSideEffects(appId: string): Promise<void>;
  deletePreferences(appId: string): Promise<void>;
};

export class AppDeleteCoordinator {
  constructor(private readonly deps: AppDeleteCoordinatorDependencies) {}

  async closeAdmission(appId: string) {
    return this.deps.lifecycleGate.run(appId, async () => {
      const record = this.requireRecord(appId);
      if (this.deps.lifecycleGate.isOpen(appId)) {
        this.deps.lifecycleGate.close(appId);
      }
      this.deps.usageRegistry.closeAdmission(appId);
      this.deps.surfaceLeases()?.revokeApp(appId);
      this.deps.managementLeases()?.revokeApp(appId);
      await this.deps.installer.cancel(appId);
      await this.deps.stop(appId);
      if (
        (record.state === "deleting" || record.state === "delete-failed") &&
        record.generationBinding.active === null
      ) {
        return record;
      }
      const generationIds = record.generations.map(
        (item) => item.generationId
      );
      return this.deps.store.update(appId, (current) => ({
        ...current,
        state: "deleting",
        lastError: null,
        lifecycleRevision: current.lifecycleRevision + 1,
        manifest: null,
        generationBinding: {
          bindingRevision: current.generationBinding.bindingRevision + 1,
          active: null,
          drainingGenerationIds: [
            ...new Set([
              ...current.generationBinding.drainingGenerationIds,
              ...generationIds,
            ]),
          ],
        },
      }));
    });
  }

  async revokeCapabilities(appId: string) {
    this.deps.gatewayRequestLeases.closeAdmission(appId);
    this.deps.surfaceLeases()?.revokeApp(appId);
    this.deps.managementLeases()?.revokeApp(appId);
    await this.deps.grantAuthority()?.revokeEverywhere(appId);
    await this.deps.closeGuiSideEffects(appId);
    const grants = this.deps.extensions()?.grants;
    if (!grants) return;
    for (const generation of this.deps.store.get(appId)?.generations ?? []) {
      await grants.revoke(appId, generation.generationId);
    }
  }

  async settleBuilds(appId: string) {
    for (const operation of this.deps.buildLedger.listNonTerminal(appId)) {
      let current = operation;
      for (const kind of participantKinds(operation)) {
        const receipt = await this.abortParticipant(kind, current);
        current = await this.deps.buildLedger.checkpoint(
          current.generationBuildId,
          current.revision,
          receipt
        );
        if (receipt.state === "aborted") continue;
        await this.deps.buildLedger.advance(
          current.generationBuildId,
          current.revision,
          "needs-attention"
        );
        throw Object.assign(
          new Error(
            "App generation build participant 尚未给出 durable abort receipt"
          ),
          { status: 409, operation: current }
        );
      }
      await this.deps.buildLedger.advance(
        current.generationBuildId,
        current.revision,
        "aborted"
      );
    }
  }

  private async abortParticipant(
    kind: AppGenerationBuildCheckpoint["kind"],
    operation: AppGenerationBuildOperation
  ): Promise<AppGenerationBuildCheckpoint> {
    try {
      return await this.deps
        .buildParticipants()!
        .require(kind)
        .abort(operation);
    } catch (cause) {
      console.warn(`[apps] ${kind} participant abort 失败`, cause);
      return {
        kind,
        operationId: `${kind}:${operation.generationBuildId}`,
        state: "needs-attention",
      };
    }
  }

  generationDrainCounts(appId: string, generationId: string) {
    const running = this.deps.runtime.isRunning(appId);
    return Promise.resolve([
      this.deps.referenceJournal.count(appId, generationId),
      this.deps.processCustody.count(appId, generationId),
      {
        providerId: "app-usage",
        count: this.deps.usageRegistry.count(appId, generationId),
        evidenceIds: [] as string[],
      },
      {
        providerId: "app-surface",
        count: this.deps.surfaceLeases()?.count(appId, generationId) ?? 0,
        evidenceIds: [] as string[],
      },
      this.deps.gatewayRequestLeases.count(appId, generationId),
      {
        providerId: "runtime-activation",
        count: running ? 1 : 0,
        evidenceIds: running ? [appId] : [],
      },
    ]);
  }

  async settleData(record: AppRecord, mode: RemoveAppMode) {
    for (const epoch of this.deps.dataCutovers.blockers(record.id)) {
      if (mode === "retain-data") {
        const archive = await this.deps.dataArchives.prepare({
          sourceAppId: record.id,
          dataEpochId: epoch.dataEpochId,
          snapshotDigest: appDigest({
            appId: record.id,
            dataEpochId: epoch.dataEpochId,
            generations: record.generations.map((item) => item.contentDigest),
          }),
          provenanceDigest: appDigest({
            appId: record.id,
            dataEpochId: epoch.dataEpochId,
          }),
        });
        await this.deps.dataCutovers.advanceEpoch(
          epoch.dataEpochId,
          "archive-pending",
          archive.archiveId
        );
        await this.deps.serverCutover.handOffEpochRoot(
          record.id,
          epoch.dataEpochId,
          join(this.deps.userData, "app-data-archives", archive.archiveId)
        );
        await this.deps.dataArchives.commit(archive.archiveId);
        await this.deps.dataCutovers.advanceEpoch(
          epoch.dataEpochId,
          "archived"
        );
      } else {
        await this.deps.dataCutovers.advanceEpoch(
          epoch.dataEpochId,
          "discard-pending"
        );
        await this.deps.serverCutover.removeEpochRoot(
          record.id,
          epoch.dataEpochId
        );
        await this.deps.dataCutovers.advanceEpoch(
          epoch.dataEpochId,
          "discarded"
        );
      }
    }
    for (const cutover of this.deps.dataCutovers.listUnsettled(record.id)) {
      if (cutover.disposition === "committed") {
        await this.deps.dataCutovers.release(
          cutover.generationBuildId,
          cutover.revision
        );
      }
    }
    await this.deps.serverCutover.removeAppData(record.id);
  }

  async removeBaseShell(record: AppRecord) {
    await this.deps.installer.cancel(record.id);
    await this.deps.stop(record.id);
    await cleanupAppFiles(
      {
        userData: this.deps.userData,
        appsRoot: this.deps.store.appsRoot,
      },
      record,
      this.deps.runtime.getOrigin(record.id)
    );
    await this.deps.deletePreferences(record.id);
    await this.deps.store.remove(record.id);
  }

  private requireRecord(appId: string) {
    const record = this.deps.store.get(appId);
    if (!record) throw new Error("App 不存在");
    return record;
  }
}

function participantKinds(operation: AppGenerationBuildOperation) {
  const kinds = new Set(operation.checkpoints.map((item) => item.kind));
  if (operation.extensionRequirements.length) kinds.add("app-extension");
  return [...kinds];
}
