/**
 * [INPUT]: Depends on crypto permit identities and the App-scoped generation/surface of the work being admitted
 * [OUTPUT]: Provides bounded side-effect permits, a single settle step, nested admission close/reopen, drain barrier, and surface cancellation
 * [POS]: gui-cutover effect authority; the only mutable-operation bridge across generation transition
 */

import { randomUUID } from "node:crypto";

/* permit 从不离开 main：它被交出去只是为了原样交回来，所以身份三元组
   （owner/epoch/generationId）核对的永远是同一个对象的副本。留下的三个字段
   都有真读者——permitId 定位、generationId 供 drain 分代、surfaceId 供关面取消。 */
export type GuiSideEffectPermit = Readonly<{
  permitId: string;
  appId: string;
  generationId: string;
  surfaceId: string;
}>;

type Entry = {
  permit: GuiSideEffectPermit;
  state: "issued" | "running";
};

export class GuiSideEffectRegistry {
  /* 嵌套关闭计数，与 GatewayRequestLeaseRegistry 同构：quarantine 与在途 cutover
     可以同时按住同一道闸门，只有最后一个松手的人才真正重开。布尔开关会让
     cutover 的 finally 替 quarantine 把门打开。 */
  private closures = 0;
  /* 只装在途 permit：settle/cancel 即出表，drain 扫的永远是真正未完成的那几条。 */
  private readonly entries = new Map<string, Entry>();

  issue(input: { appId: string; generationId: string; surfaceId: string }) {
    if (this.closures > 0) throw new Error("GUI_SIDE_EFFECT_ADMISSION_CLOSED");
    const permit: GuiSideEffectPermit = Object.freeze({
      permitId: randomUUID(),
      ...input,
    });
    this.entries.set(permit.permitId, { permit, state: "issued" });
    return permit;
  }

  start(permit: GuiSideEffectPermit) {
    const entry = this.require(permit);
    if (entry.state !== "issued") throw new Error("GUI_SIDE_EFFECT_ALREADY_STARTED");
    entry.state = "running";
  }

  /** 完成即交付：`result-pending` 中间态没有任何观察者，两步只是同一件事。 */
  settle(permit: GuiSideEffectPermit) {
    const entry = this.require(permit);
    if (entry.state !== "running") throw new Error("GUI_SIDE_EFFECT_NOT_RUNNING");
    this.entries.delete(permit.permitId);
  }

  cancelSurface(surfaceId: string) {
    for (const [permitId, entry] of this.entries) {
      if (entry.permit.surfaceId === surfaceId) this.entries.delete(permitId);
    }
  }

  cancel(permit: GuiSideEffectPermit) {
    this.entries.delete(permit.permitId);
  }

  closeAdmission() {
    this.closures += 1;
  }

  /** 与 close 一一配对；未配对的 reopen 是 no-op。 */
  reopenAdmission() {
    if (this.closures > 0) this.closures -= 1;
  }

  activeCount(generationId?: string) {
    return [...this.entries.values()].filter(
      (entry) => !generationId || entry.permit.generationId === generationId
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
    if (!entry) throw new Error("GUI_SIDE_EFFECT_PERMIT_INVALID");
    return entry;
  }
}
