/**
 * [INPUT]: Depends on shared fixed side-effect kinds and generation/owner/epoch fence identities
 * [OUTPUT]: Provides bounded side-effect permits, owner fencing, request/result lifecycle, nested admission close/reopen, drain barrier, and surface cancellation
 * [POS]: gui-cutover effect authority; the only mutable-operation bridge across generation transition
 */

import { randomUUID } from "node:crypto";
import type { GuiSideEffectKindV1 } from "../../../../shared/app-gui/cutover";

export type GuiSideEffectPermit = Readonly<{
  permitId: string;
  appId: string;
  generationId: string;
  surfaceId: string;
  ownerId: string;
  epoch: number;
  kind: GuiSideEffectKindV1;
  expiresAt: number;
}>;

type Entry = {
  permit: GuiSideEffectPermit;
  state: "issued" | "running" | "result-pending" | "settled" | "cancelled";
  result?: unknown;
};

export class GuiSideEffectRegistry {
  private ownerId = randomUUID();
  private epoch = 0;
  /* 嵌套关闭计数，与 GatewayRequestLeaseRegistry 同构：quarantine 与在途 cutover
     可以同时按住同一道闸门，只有最后一个松手的人才真正重开。布尔开关会让
     cutover 的 finally 替 quarantine 把门打开。 */
  private closures = 0;
  private readonly entries = new Map<string, Entry>();

  fence() {
    return Object.freeze({ ownerId: this.ownerId, epoch: this.epoch, admissionOpen: this.closures === 0 });
  }

  issue(input: {
    appId: string;
    generationId: string;
    surfaceId: string;
    kind: GuiSideEffectKindV1;
    ttlMs?: number;
  }) {
    if (this.closures > 0) throw new Error("GUI_SIDE_EFFECT_ADMISSION_CLOSED");
    const permit: GuiSideEffectPermit = Object.freeze({
      permitId: randomUUID(),
      ...input,
      ownerId: this.ownerId,
      epoch: this.epoch,
      expiresAt: Date.now() + Math.min(Math.max(input.ttlMs ?? 30_000, 1_000), 120_000),
    });
    this.entries.set(permit.permitId, { permit, state: "issued" });
    return permit;
  }

  start(permit: GuiSideEffectPermit) {
    const entry = this.require(permit);
    if (entry.state !== "issued") throw new Error("GUI_SIDE_EFFECT_ALREADY_STARTED");
    if (permit.expiresAt <= Date.now()) {
      entry.state = "cancelled";
      throw new Error("GUI_SIDE_EFFECT_PERMIT_EXPIRED");
    }
    entry.state = "running";
  }

  complete(permit: GuiSideEffectPermit, result: unknown) {
    const entry = this.require(permit);
    if (entry.state !== "running") throw new Error("GUI_SIDE_EFFECT_NOT_RUNNING");
    entry.state = "result-pending";
    entry.result = structuredClone(result);
  }

  deliver(permit: GuiSideEffectPermit) {
    const entry = this.require(permit);
    if (entry.state !== "result-pending") throw new Error("GUI_SIDE_EFFECT_RESULT_NOT_READY");
    entry.state = "settled";
    return structuredClone(entry.result);
  }

  cancelSurface(surfaceId: string) {
    for (const entry of this.entries.values()) {
      if (entry.permit.surfaceId === surfaceId && !settled(entry.state)) entry.state = "cancelled";
    }
  }

  cancel(permit: GuiSideEffectPermit) {
    const entry = this.require(permit);
    if (!settled(entry.state)) entry.state = "cancelled";
  }

  closeAdmission() {
    this.closures += 1;
    this.epoch += 1;
    return this.fence();
  }

  /** 与 close 一一配对；未配对的 reopen 是 no-op，不轮换 owner、不误伤在途 permit。 */
  reopenWithNewOwner() {
    if (this.closures === 0) return this.fence();
    this.closures -= 1;
    if (this.closures > 0) return this.fence();
    this.ownerId = randomUUID();
    this.epoch += 1;
    this.prune();
    return this.fence();
  }

  activeCount(generationId?: string) {
    return [...this.entries.values()].filter(
      (entry) => !settled(entry.state) && (!generationId || entry.permit.generationId === generationId)
    ).length;
  }

  async drain(generationId: string, deadlineMs: number) {
    while (this.activeCount(generationId) > 0) {
      if (Date.now() >= deadlineMs) throw new Error("GUI_SIDE_EFFECT_BARRIER_TIMEOUT");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private require(permit: GuiSideEffectPermit) {
    const entry = this.entries.get(permit.permitId);
    if (
      !entry ||
      entry.permit.ownerId !== permit.ownerId ||
      entry.permit.epoch !== permit.epoch ||
      entry.permit.generationId !== permit.generationId
    ) throw new Error("GUI_SIDE_EFFECT_PERMIT_INVALID");
    return entry;
  }

  private prune() {
    for (const [permitId, entry] of this.entries) {
      if (settled(entry.state)) this.entries.delete(permitId);
    }
  }
}

function settled(state: Entry["state"]) {
  return state === "settled" || state === "cancelled";
}
