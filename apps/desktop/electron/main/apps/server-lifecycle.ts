/**
 * [INPUT]: Depends on AppServerCustodyRuntime, AppServerDataCutover and the gateway/runtime/store/gate narrow accessor that combines the root input
 * [OUTPUT]: Provides compose ServerLifecycle: cutover four verbs (including the "closing access/removing route/ drain/stop process") with the start of the line-by-line check
 * [POS]: The app's server lifecycle connection points; It's a way to separate "who's going to shut down access, who's going to shut down" from the division responsibilities of AppsService
 */

import type { AppLifecycleAdmissionGate } from "../lifecycle/app-platform-admission";
import type { AppServerCutoverEnvironment } from "./app-server-cutover";
import type { AppServerDataCutover } from "./app-server-cutover";
import type { AppServerCustodyRuntime } from "./runtime/server-custody";

/** drain 的上限：等不到零就如实 409，绝不拿「等够久了」冒充已排空。 */
const DRAIN_TIMEOUT_MS = 30_000;

export type ServerLifecycleDependencies = {
  custody: AppServerCustodyRuntime;
  cutover: AppServerDataCutover;
  lifecycleGate: AppLifecycleAdmissionGate;
  gatewayRequests: {
    closeAdmission(appId: string): void;
    reopenAdmission(appId: string): void;
    countApp(appId: string): number;
  };
  revokeRoute(appId: string): void;
  stopRuntime(appId: string): Promise<void>;
  unsettledCustody(appId: string): number;
  activeServerBinding(
    appId: string
  ): Readonly<{ generationId: string; dataEpochId: string }> | null;
  appDir(appId: string): string | null;
};

export function composeServerLifecycle(deps: ServerLifecycleDependencies) {
  /** cutover 自己关掉的那一版 lifecycle admission；不是自己关的绝不撤。 */
  const owned = new Map<string, number>();

  const environment: AppServerCutoverEnvironment = {
    closeAdmission: (appId) => {
      deps.gatewayRequests.closeAdmission(appId);
      /* 只记自己关的那一版：delete 之类别的 owner 若在此期间接手，
         reopen 就不该把它的关闭状态一并撤掉。 */
      if (deps.lifecycleGate.isOpen(appId)) {
        owned.set(appId, deps.lifecycleGate.close(appId));
      }
    },
    reopenAdmission: (appId) => {
      deps.gatewayRequests.reopenAdmission(appId);
      const revision = owned.get(appId);
      if (revision === undefined) return;
      owned.delete(appId);
      if (deps.lifecycleGate.revision(appId) === revision) {
        deps.lifecycleGate.reopen(appId, revision);
      }
    },
    revokeRoute: (appId) => deps.revokeRoute(appId),
    /** 关 admission 只让新请求进不来；等不来零就不算 drain。 */
    drainRequests: async (appId) => {
      const deadline = Date.now() + DRAIN_TIMEOUT_MS;
      while (deps.gatewayRequests.countApp(appId) > 0) {
        if (Date.now() >= deadline) {
          throw Object.assign(
            new Error(
              `APP_GATEWAY_DRAIN_TIMEOUT: ${appId} 仍有 ${deps.gatewayRequests.countApp(appId)} 条在途请求`
            ),
            { status: 409 }
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    stopRuntime: (appId) => deps.stopRuntime(appId),
    unsettledCustody: (appId) => deps.unsettledCustody(appId),
    activeServerBinding: (appId) => deps.activeServerBinding(appId),
    appDir: (appId) => deps.appDir(appId),
  };

  /**
   * 启动逐 phase 对账：先 custody（谁还活着），再 cutover（哪一份数据是真的）。
   * 顺序固定——cutover 的回退要删 target 目录，而目录里可能还有活进程在写；
   * 必须等 custody 给出「已退出或 quarantine」的结论之后才动字节。
   */
  async function reconcile() {
    const custody = await deps.custody.reconcile();
    const cutover = await deps.cutover.reconcile();
    if (cutover.committed.length || cutover.rolledBack.length || cutover.released.length) {
      console.warn(
        `[apps] server data cutover 对账：完成 ${cutover.committed.length} 条，回退 ${cutover.rolledBack.length} 条，退役 ${cutover.released.length} 条`
      );
    }
    /* quarantine 的 App 一律 fail closed：不发信号、不发 route、不起新代。
       关 gate 放在 cutover 之后，因为那一步会 reopen 它自己关过的准入。 */
    for (const appId of deps.custody.quarantinedAppIds()) {
      if (deps.lifecycleGate.isOpen(appId)) deps.lifecycleGate.close(appId);
      console.error(`[apps] ${appId} 的 server 进程状态无法确认，保持 quarantine`);
    }
    deps.custody.openAdmission();
    return { custody, cutover };
  }

  return { environment, reconcile };
}
