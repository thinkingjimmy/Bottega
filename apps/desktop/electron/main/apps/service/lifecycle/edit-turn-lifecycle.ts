/**
 * [INPUT]: Depends on AppStore, chat-role lookup, source-mutation settlement, maintenance admission, installer rebuild/reconciliation, GUI resync, skill status, and event callbacks
 * [OUTPUT]: Provides AppEditTurnLifecycle terminal handlers that rebuild or reconcile source before releasing edit-turn mutation custody
 * [POS]: apps/service turn terminal coordinator; closes the shared per-App mutation window after post-agent lifecycle transitions
 */

import type { AppInstallEvent, AppRecord } from "../../../../../shared/apps-ipc";
import { asError } from "../../../errors";
import type { AppInstaller } from "../../app-installer";
import { completeBaseAppSkill, failBaseAppSkill } from "../../app-skill-status";
import type { AppStore } from "../../app-store";
import type { MaintenanceGate } from "../../maintenance-gate";
import { appTurnCompletionAction } from "../turn-action";

type Ports = Readonly<{
  store: AppStore;
  installer: AppInstaller;
  maintenanceGate: MaintenanceGate;
  chatRole(conversationId: string): "edit" | "use" | undefined;
  syncGui(appId: string): Promise<unknown>;
  emit(event: AppInstallEvent): void;
  invalidateSkills(): void;
  settleSourceMutation<T>(requestId: string, task: () => Promise<T>): Promise<T>;
}>;

function isCreateSkillTurn(record: AppRecord | undefined, requestId: string) {
  return Boolean(
    record?.manifest?.kind === "base" &&
      record.skillStatus?.state === "pending" &&
      requestId === `${record.skillStatus.turnIntentId}-request`
  );
}

export class AppEditTurnLifecycle {
  constructor(private readonly ports: Ports) {}

  async completed(appId: string, conversationId: string, requestId = "") {
    const record = this.ports.store.get(appId);
    const action = appTurnCompletionAction(
      record?.domainIdentity ?? null,
      this.ports.chatRole(conversationId),
      isCreateSkillTurn(record, requestId)
    );
    return this.ports.settleSourceMutation(requestId, async () => {
      if (action === "none") return;
      if (this.ports.maintenanceGate.isLocked(appId)) {
        throw new Error("App 修复中，暂时不能应用编辑");
      }
      if (action === "rebuild") {
        return this.ports.installer.rebuildAfterEditHeld(appId);
      }
      await this.ports.syncGui(appId).catch((cause) =>
        console.warn("[apps] base-gui route 同步失败", asError(cause))
      );
      this.ports.emit({ appId, type: "gui" });
      return completeBaseAppSkill(appId, requestId, {
        store: this.ports.store,
        invalidate: this.ports.invalidateSkills,
      });
    });
  }

  async failed(appId: string, conversationId: string, requestId = "") {
    const record = this.ports.store.get(appId);
    const action = appTurnCompletionAction(
      record?.domainIdentity ?? null,
      this.ports.chatRole(conversationId),
      isCreateSkillTurn(record, requestId)
    );
    return this.ports.settleSourceMutation(requestId, async () => {
      if (action === "none") return;
      await this.ports.installer.reconcileSourceHeld(appId);
      if (action === "skill") {
        return failBaseAppSkill(appId, requestId, { store: this.ports.store });
      }
    });
  }
}
