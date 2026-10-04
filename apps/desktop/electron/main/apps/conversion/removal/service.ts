/**
 * [INPUT]: Depends on original lifecycle claims and the existing App drain, Chat retention, build, grant and server-data participants.
 * [OUTPUT]: Retires local installation with original journals, preserving files and transcripts; confirmed cloud deletion also fences the portable identity.
 * [POS]: Shared installation retirement saga; Base/Project cloud disposition remains with their existing Store adapters.
 */
import { sameScope, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { canonicalJson, hashBytes } from "@ai-chat/cloud-protocol";
import { appDeletionSchema, type CloudAppDeletion } from "@ai-chat/cloud-protocol/apps/model";
import { join } from "node:path";
import { releaseCompletedAppSource, retainCapturedAppSource } from "../../share/package/cloud-source";
import type { AppConfigStore } from "../../share/app-config-store";
import { reached, type LifecycleIntent } from "../../../lifecycle/intent-types";
import type { SagaResult } from "../../../lifecycle/admission-gate";
import type { AppDeleteDependencies } from "../app-delete";
import { appRemovalSchema, localAppRemovalSchema, cloudAppRetirementSchema, type LocalAppRemoval } from "./contract";
import { LocalAppRemovalFiles, hasLocalAppRemoval, localAppRemovalDirectory } from "./files";
type Ports = Pick<AppDeleteDependencies, "store" | "intents" | "gate" | "runExclusive" |
  "listAppChats" | "drainAppTurns" | "removeAppChat" | "closeAdmission" | "settleBuilds" | "retireGeneration" |
  "revokeCapabilities" | "settleData" | "publishRemoval" | "reportProgress"> & {
  userData: string; configs: Pick<AppConfigStore, "read" | "write">; projects: Pick<AppDeleteDependencies["projects"], "runExclusive" | "store">;
  coordinator: Pick<AppDeleteDependencies["coordinator"], "runConversationExclusive">;
  checkpoint?(phase: string): Promise<void>;
};
export class AppLocalRemovalService {
  constructor(private ports: Ports) {}
  hasRetainedFiles(scope: SyncScope, appId: string) { return hasLocalAppRemoval(this.ports.userData, scope, appId); }
  async retainedDirectory(scope: SyncScope, appId: string) {
    if (!await this.hasRetainedFiles(scope, appId)) throw new Error("APP_REMOVAL_ARCHIVE_UNAVAILABLE");
    return localAppRemovalDirectory(this.ports.userData, scope, appId);
  }
  async remove(requestId: string, value: LocalAppRemoval) {
    const input = localAppRemovalSchema.parse(value);
    const entry = this.ports.store.portable.get(input.appId);
    if (!entry || !sameScope(entry.scope, input.scope)) throw new Error("APP_REMOVAL_SCOPE_CHANGED");
    const run = () => this.ports.gate.admitAndRun({ kind: "app-local-remove", requestId, input,
      allocate: () => ({ projectId: entry.descriptor.projectId }) }, intent => this.execute(intent));
    const outcome = this.ports.runExclusive ? await this.ports.runExclusive(input.appId, run) : await run();
    if (outcome.state === "settled" && outcome.status !== "done" || outcome.state === "executed" && outcome.result.status !== "done") {
      throw new Error("APP_LOCAL_REMOVAL_REJECTED");
    }
  }
  async retry(requestId: string) {
    const found = await this.ports.intents.readByRequest("app-local-remove", requestId);
    if (found?.result.state !== "pending") throw new Error("APP_LOCAL_REMOVAL_UNAVAILABLE");
    // Interactive retries enter the same outer lifecycle lane as the original request.
    return this.remove(requestId, localAppRemovalSchema.parse(found.result.intent.input));
  }
  async retire(scope: SyncScope, rawDeletion: CloudAppDeletion) {
    const deletion = appDeletionSchema.parse(rawDeletion), appId = deletion.appId;
    const requestId = hashBytes(new TextEncoder().encode(canonicalJson(["app-retirement", scope, deletion.tombstone])));
    const run = async () => {
      const original = await this.ports.intents.readByRequest("app-cloud-retire", requestId);
      const record = this.ports.store.get(appId);
      const input = original?.result.state === "pending" ? cloudAppRetirementSchema.parse(original.result.intent.input) :
        cloudAppRetirementSchema.parse({ scope, appId, deletion, generationId: record?.generationBinding.active?.generationId ?? null,
          bindingRevision: record?.generationBinding.bindingRevision ?? 0 });
      if (!sameScope(input.scope, scope) || input.deletion.projectId !== deletion.projectId || input.deletion.baseId !== deletion.baseId ||
        input.deletion.revision !== deletion.revision) throw new Error("APP_RETIREMENT_IDENTITY_CHANGED");
      const entry = this.ports.store.portable.get(appId);
      if (!entry || !sameScope(entry.scope, scope)) throw new Error("APP_REMOVAL_SCOPE_CHANGED");
      if (entry.descriptor.projectId !== deletion.projectId || entry.descriptor.baseId !== deletion.baseId ||
        entry.descriptor.cloudRevision > deletion.revision || entry.descriptor.cloudRevision === deletion.revision && !entry.tombstoned) throw new Error("APP_RETIREMENT_IDENTITY_CHANGED");
      if (original && original.result.state !== "pending") {
        if (record || !entry.tombstoned) throw new Error("APP_RETIREMENT_INCOMPLETE"); return;
      }
      const result = await this.ports.gate.admitAndRun({ kind: "app-cloud-retire", requestId, input,
        allocate: () => ({ projectId: deletion.projectId }) }, intent => this.execute(intent));
      if (result.state === "settled" && result.status !== "done" || result.state === "executed" && result.result.status !== "done") throw new Error("APP_RETIREMENT_REJECTED");
    };
    return this.ports.runExclusive ? this.ports.runExclusive(appId, run) : run();
  }
  recover(intent: LifecycleIntent) {
    const input = appRemovalSchema.parse(intent.input);
    return this.ports.runExclusive ? this.ports.runExclusive(input.appId, () => this.execute(intent)) : this.execute(intent);
  }
  async settleScopeCleanup(scope: SyncScope, _operationId: string, current: () => void, appId?: string) {
    for (const intent of await this.ports.intents.listPending()) {
      if (!["app-local-remove", "app-cloud-retire"].includes(intent.kind)) continue;
      const input = appRemovalSchema.parse(intent.input); if (!sameScope(input.scope, scope)) continue;
      if (appId && input.appId !== appId) continue;
      current();
      if ("deletion" in input) await this.retire(scope, input.deletion); else await this.retry(intent.requestId);
      current();
    }
  }
  private execute(initial: LifecycleIntent): Promise<SagaResult> {
    return this.ports.projects.runExclusive(async () => {
      const kind = initial.kind;
      if (kind !== "app-local-remove" && kind !== "app-cloud-retire") throw new Error("APP_LOCAL_REMOVAL_INVALID");
      const input = kind === "app-local-remove" ? localAppRemovalSchema.parse(initial.input) : cloudAppRetirementSchema.parse(initial.input), appId = input.appId;
      const deletion = "deletion" in input ? input.deletion : null;
      let intent = initial;
      const advance = async (phase: string) => {
        await this.ports.checkpoint?.(`before:${phase}`);
        intent = await this.ports.intents.advance(intent.intentId, phase);
        await this.ports.checkpoint?.(phase);
      };
      const entry = this.ports.store.portable.get(appId);
      if (!entry || !sameScope(entry.scope, input.scope) || entry.descriptor.projectId !== intent.allocated.projectId) throw new Error("APP_REMOVAL_SCOPE_CHANGED");
      if (deletion) await this.ports.store.portable.acceptDeletion(input.scope, deletion);
      let record = this.ports.store.get(appId);
      if (!reached(kind, intent, "verified")) {
        const project = this.ports.projects.store.get(entry.descriptor.projectId);
        if (!project ? !deletion : !project.sync || !sameScope(project.sync.scope, input.scope) ||
          !(project.workspaceBinding.kind === "app" && project.workspaceBinding.appId === appId || deletion && project.role === "base-custody")) throw new Error("APP_REMOVAL_PROJECT_CHANGED");
        if ((!record && !deletion) || (record?.generationBinding.active?.generationId ?? null) !== input.generationId ||
          (record?.generationBinding.bindingRevision ?? 0) !== input.bindingRevision) {
          return { status: "business-rejected", error: { code: "APP_REMOVAL_INSTALLATION_CHANGED", message: "The local App installation changed. Review it again." } };
        }
        await advance("verified");
      }
      if (!record) {
        if (!reached(kind, intent, "data-retained") && !(deletion && input.generationId === null)) throw new Error("APP_REMOVAL_RECORD_MISSING");
        await releaseCompletedAppSource(this.ports.store, input.scope, appId);
        this.ports.publishRemoval(appId);
        return { status: "done", receipt: { appId, projectId: entry.descriptor.projectId, retained: true } };
      }
      this.ports.reportProgress(appId);
      record = await this.ports.closeAdmission(appId);
      if (!reached(kind, intent, "admission-closed")) await advance("admission-closed");
      if (!reached(kind, intent, "source-retained")) {
        const source = this.ports.store.portable.publication.list(input.scope).find(plan => plan.operation.appId === appId)?.source;
        if (input.generationId || source) await retainCapturedAppSource(this.ports.store, input.scope, appId, join(this.ports.userData, "app-source-retention"),
          input.generationId ? { generationId: input.generationId, bindingRevision: input.bindingRevision } : undefined);
        await advance("source-retained");
      }
      if (!reached(kind, intent, "turns-drained")) { await this.ports.drainAppTurns(appId); await advance("turns-drained"); }
      if (!reached(kind, intent, "chats-retained")) {
        for (const chatId of this.ports.listAppChats(appId)) {
          await this.ports.coordinator.runConversationExclusive(chatId, () => this.ports.removeAppChat(chatId, appId));
        }
        await this.ports.store.update(appId, current => ({ ...current, editChatSlot: null, activeUseChatSlot: null, activeUseSwitch: null }));
        await advance("chats-retained");
      }
      if (!reached(kind, intent, "builds-settled")) { await this.ports.settleBuilds(appId); await advance("builds-settled"); }
      if (!reached(kind, intent, "generations-retired")) {
        for (const generation of record.generations) await this.ports.retireGeneration(appId, generation.generationId);
        await advance("generations-retired");
      }
      if (!reached(kind, intent, "grants-settled")) {
        await this.ports.revokeCapabilities(appId);
        const config = await this.ports.configs.read(appId);
        if (config.agentReadableKeys.length) await this.ports.configs.write(appId, { ...config, agentReadableKeys: [] });
        await advance("grants-settled");
      }
      if (!reached(kind, intent, "workspace-retained")) {
        await new LocalAppRemovalFiles(this.ports.userData, intent.requestId, input,
          this.ports.store.sourceDirectory(appId)).retain(record.dir);
        await advance("workspace-retained");
      }
      if (!reached(kind, intent, "data-retained")) { await this.ports.settleData(record, "retain-data"); await advance("data-retained"); }
      await this.ports.store.remove(appId);
      await advance("record-removed");
      await releaseCompletedAppSource(this.ports.store, input.scope, appId);
      this.ports.publishRemoval(appId);
      return { status: "done", receipt: { appId, projectId: entry.descriptor.projectId, retained: true } };
    });
  }
}
