/**
 * [INPUT]: Depends on the App navigation's rebuild availability, the maintenance lock and the installer's retry of a failed update.
 * [OUTPUT]: Provides startRemoteRebuild: a remote "Try again" (U06-d) refused by code, converged on the build that runs or landed, or a
 *           failed after-edit build retried in the background (its progress is the build status, not the command's answer).
 * [POS]: apps/service/lifecycle's one rule for app/rebuild, used by AppsService.remoteRebuild; never Repair (Q-U4).
 */
import type { RebuildAvailability } from "../../turn/app-navigation";

export function startRemoteRebuild(appId: string, ports: Readonly<{ availability(appId: string): RebuildAvailability; locked(appId: string): boolean;
  retry(appId: string): Promise<unknown>; report(cause: unknown): void }>) {
  const decision = ports.availability(appId);
  if (decision.code) throw new Error(decision.code);
  if (ports.locked(appId)) throw new Error("app-transitioning");
  if (decision.action === "retry") void ports.retry(appId).catch(cause => ports.report(cause));
}
