/**
 * [INPUT]: Depends on the original install journal, verified source custody and local Store/configuration owners.
 * [OUTPUT]: Settles interrupted installation locally before account detachment or confirmed App retirement, without network or new authorization.
 * [POS]: Original App installation recovery; an activated generation's files are retained and unfinished approval is cancelled.
 */
import { join } from "node:path";
import { z } from "zod";
import { sameScope, syncScopeSchema, storageIdSchema, canonicalJson, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { reached } from "../../../lifecycle/intent-types";
import { exportAppGenerationSource } from "../../share/package/cloud-source";
import { cloudAppInstallSchema } from "./contract";
import { CloudAppInstallFiles } from "./files";
import type { CloudAppInstallPorts } from "./installer";
import { appDeletionSchema, type CloudAppDeletion } from "@ai-chat/cloud-protocol/apps/model";
const markerSchema = z.object({ scope: syncScopeSchema, cleanupOperationId: storageIdSchema,
  disposition: z.enum(["cancel", "complete"]), generationId: storageIdSchema.nullable(), deletion: appDeletionSchema.optional() }).strict();
export async function settleCloudInstallations(ports: CloudAppInstallPorts, scope: SyncScope, cleanupOperationId: string, current: () => void, deletion?: CloudAppDeletion) {
  for (const pending of await ports.journal.listPending()) {
    if (pending.kind !== "app-cloud-install" || pending.parentIntentId) continue;
    const input = cloudAppInstallSchema.parse(pending.input);
    if (!sameScope(input.scope, scope) || deletion && input.descriptor.appId !== deletion.appId) continue;
    current();
    await ports.gate.runRecovery(pending.intentId, async initial => {
      current(); let intent = initial;
      const { descriptor } = input, appId = descriptor.appId;
      const files = new CloudAppInstallFiles(ports.userData, intent.requestId, input, ports.apps.sourceDirectory(appId));
      const active = ports.apps.get(appId)?.generationBinding.active?.generationId ?? null;
      const generationId = typeof intent.recoveryState.generationId === "string" ? intent.recoveryState.generationId : null;
      if (active !== input.previousGenerationId && active !== generationId) throw new Error("APP_INSTALLATION_LOCAL_BINDING_CHANGED");
      const original = intent.recoveryState.scopeCleanup ? markerSchema.parse(intent.recoveryState.scopeCleanup) : null;
      const originalDeletion = original?.deletion ?? deletion;
      const calculated = markerSchema.parse({ scope, cleanupOperationId: original?.deletion ? original.cleanupOperationId : cleanupOperationId,
        disposition: active && active === generationId ? "complete" : "cancel", generationId,
        ...(originalDeletion ? { deletion: originalDeletion } : {}) });
      const marker = original ?? calculated;
      if (canonicalJson(marker) !== canonicalJson(calculated)) throw new Error("APP_INSTALLATION_CLEANUP_CHANGED");
      const verify = async (id: string) => {
        const value = await exportAppGenerationSource(ports.apps, appId, id, join(ports.userData, "app-source-verification"));
        if (value.manifestDigest !== descriptor.manifestDigest || value.sourcePackageDigest !== descriptor.sourcePackageDigest) throw new Error("APP_INSTALLATION_PACKAGE_CONFLICT");
        current();
      };
      if (marker.disposition === "complete") await verify(marker.generationId!);
      if (!intent.recoveryState.scopeCleanup) {
        intent = await ports.journal.advance(intent.intentId, intent.phase, { scopeCleanup: marker });
        await ports.checkpoint?.("cleanup:disposition"); current();
      }
      if (marker.disposition === "cancel") {
        const record = ports.apps.get(appId);
        if (reached("app-cloud-install", intent, "activated")) throw new Error("APP_INSTALLATION_LOCAL_BINDING_CHANGED");
        if (record?.generationBinding.pending) {
          await verify(record.generationBinding.pending.generationId);
          await ports.apps.abortPendingGeneration(appId, record.generationBinding.pending.generationId); current();
        }
        if (record && !active) { await ports.apps.remove(appId); current(); }
        if (record && active && marker.deletion) { await ports.apps.update(appId, value => ({ ...value, state: "deleting" })); current(); }
        if (!active) ports.removed?.(appId);
        await ports.apps.portable.cancelInstallation(appId, scope); current();
        await ports.configs.removePending(files.configReference); current();
        return { status: "business-rejected", error: { code: "CLOUD_SCOPE_DETACHED", message: "Local installation stopped during account cleanup." } };
      }
      // Promotion already committed the original local consent. Finish only its file/configuration publication.
      const verified = await files.read(); current();
      const config = reached("app-cloud-install", intent, "workspace-ready") ? await ports.configs.read(appId) : await ports.configs.readPending(files.configReference);
      current();
      if (!reached("app-cloud-install", intent, "activated")) intent = await ports.journal.advance(intent.intentId, "activated");
      if (!reached("app-cloud-install", intent, "workspace-ready")) {
        await files.publishWorkspace(ports.apps.sourceDirectory(appId)); current();
        await ports.configs.write(appId, config, verified.manifest.requirements?.tools ?? []); current();
        intent = await ports.journal.advance(intent.intentId, "workspace-ready");
        await ports.checkpoint?.("cleanup:workspace"); current();
      }
      if (marker.deletion) await ports.apps.portable.completeInstallationForRetirement(scope, descriptor, marker.generationId!, marker.deletion);
      else await ports.apps.portable.completeInstallationForCleanup(scope, descriptor, marker.generationId!);
      current();
      const record = await ports.apps.update(appId, value => ({ ...value, state: marker.deletion ? "deleting" : "ready", lastError: null, pendingInstallRequirements: undefined }));
      await ports.journal.advance(intent.intentId, "installed"); await ports.configs.removePending(files.configReference); current();
      return { status: "done", value: record, receipt: { appId, projectId: descriptor.projectId, baseId: descriptor.baseId,
        packageRevision: descriptor.packageRevision, generationId: marker.generationId, cleanupOperationId } };
    });
    if ((await ports.journal.listPending()).some(intent => intent.intentId === pending.intentId)) throw new Error("APP_INSTALLATION_CLEANUP_PENDING");
  }
}
