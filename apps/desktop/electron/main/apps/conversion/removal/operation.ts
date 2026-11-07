/**
 * [INPUT]: Original App deletion participants, durable intent/kind/config facts and retained-folder/data authorities.
 * [OUTPUT]: Executes the original ordered delete/uninstall/recovery steps inside the caller's Project exclusive boundary.
 * [POS]: Operation-only body of AppDeleteService; startup retains admission/flight registration without loading cleanup execution.
 */
import { reached, type LifecycleIntent } from "../../../lifecycle/intent-types";
import type { SagaResult } from "../../../lifecycle/admission-gate";
import type { AppDeleteDependencies, AppDeletionMode } from "../app-delete";

export async function executeAppDeletion(dependencies: AppDeleteDependencies, initial: LifecycleIntent): Promise<SagaResult> {
  const input = initial.input as {
    appId: string;
    mode: AppDeletionMode;
  };
  dependencies.reportProgress(input.appId);
  let intent = initial;
  let record = dependencies.store.get(input.appId);
  const uninstall = input.mode === "uninstall", retained = uninstall ? await import("./uninstall") : null;
  const appKind = retained ? retained.uninstallKind(initial) : record?.manifest?.kind;
  if (!record) {
    // Startup reconciliation owns orphan Project placements after the shell commit.
    if (retained) await retained.verifyUninstall(dependencies, initial);
    await dependencies.finalizeRemoval(input.appId);
    dependencies.publishRemoval(input.appId);
    return { status: "done", receipt: { appId: input.appId } };
  }
  const baseApp = appKind === "base", retainBase = input.mode === "retain-data" || uninstall && baseApp;
  if (!baseApp && input.mode === "retain-data") {
    return {
      status: "business-rejected",
      error: {
        code: "RETAIN_DATA_REQUIRES_BASE_APP",
        message: "只有 Base App 支持保留 Project 数据",
      },
    };
  }
  // Ordinary Apps also create Projects lazily; their bindings need the same finalization.
  const project = dependencies.projects.store.findByAppId(input.appId);

  record = await dependencies.closeAdmission(input.appId);
  if (!reached("app-delete", intent, "admission-closed")) {
    intent = await dependencies.intents.advance(
      intent.intentId,
      "admission-closed"
    );
  }

  if (!reached("app-delete", intent, "turns-drained")) {
    await dependencies.drainAppTurns(input.appId);
    intent = await dependencies.intents.advance(
      intent.intentId,
      "turns-drained",
      project ? { projectId: project.id } : undefined
    );
  }

  if (!reached("app-delete", intent, "chats-settled")) {
    for (const chatId of dependencies.listAppChats(input.appId)) {
      await dependencies.coordinator.runConversationExclusive(
        chatId,
        () => dependencies.removeAppChat(chatId, input.appId)
      );
    }
    await dependencies.store.update(input.appId, (current) => ({
      ...current,
      editChatSlot: null,
      activeUseChatSlot: null,
      activeUseSwitch: null,
    }));
    intent = await dependencies.intents.advance(
      intent.intentId,
      "chats-settled"
    );
  }

  // Only retained Base promotion has an effect that needs this durable checkpoint.
  if (retainBase && !reached("app-delete", intent, "base-settled")) {
    const projectId = project?.id ?? recoveryProjectId(intent);
    if (!projectId) throw new Error("Retained Base custody Project is missing");
    await dependencies.promoteRetainedBase(projectId);
    intent = await dependencies.intents.advance(
      intent.intentId,
      "base-settled"
    );
  }

  if (!reached("app-delete", intent, "project-settled")) {
    if (project) {
      if (!retainBase) {
        await dependencies.projects.removeAppProjectHeld(
          project.id,
          input.appId
        );
      } else {
        await dependencies.convertToBaseCustody(project.id, input.appId);
      }
    } else if (retainBase) {
      const projectId = recoveryProjectId(intent);
      if (!projectId) throw new Error("Retained Base custody Project is missing");
      await dependencies.convertToBaseCustody(projectId, input.appId);
    }
    intent = await dependencies.intents.advance(
      intent.intentId,
      "project-settled"
    );
  }

  if (!reached("app-delete", intent, "builds-settled")) {
    await dependencies.settleBuilds(input.appId);
    intent = await dependencies.intents.advance(
      intent.intentId,
      "builds-settled"
    );
  }

  if (!reached("app-delete", intent, "generations-retired")) {
    for (const generation of record.generations) {
      await dependencies.retireGeneration(
        input.appId,
        generation.generationId
      );
    }
    intent = await dependencies.intents.advance(
      intent.intentId,
      "generations-retired"
    );
  }

  if (!reached("app-delete", intent, "grants-settled")) {
    await dependencies.revokeCapabilities(input.appId);
    intent = await dependencies.intents.advance(
      intent.intentId,
      "grants-settled"
    );
  }

  if (!reached("app-delete", intent, "data-settled")) {
    await dependencies.settleData(record, input.mode === "uninstall" ? "retain-data" : input.mode);
    intent = await dependencies.intents.advance(
      intent.intentId,
      "data-settled"
    );
  }

  // Cleanup reports its changed Projects; replay returns none and emits no duplicate events.
  const { affectedProjectIds } =
    await dependencies.projects.clearAppPlacementsHeld(input.appId);
  dependencies.projects.publishProjectUpserts(affectedProjectIds);

  const current = dependencies.store.get(input.appId);
  if (current) await dependencies.removeShell(current, uninstall ? { retainedRequestId: intent.requestId } : undefined);
  if (retained) await retained.verifyUninstall(dependencies, intent);
  await dependencies.finalizeRemoval(input.appId);
  dependencies.publishRemoval(input.appId);
  return { status: "done", receipt: { appId: input.appId } };
}


function recoveryProjectId(intent: LifecycleIntent) {
  const value = intent.recoveryState.projectId;
  return typeof value === "string" ? value : null;
}
