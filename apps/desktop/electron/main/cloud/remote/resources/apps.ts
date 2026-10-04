/**
 * [INPUT]: Depends on the App navigation service's remote opens (never taking the window) once App mode has configured it.
 * [OUTPUT]: Provides appResourcePort and RemoteApps, sharing owner-controlled enablement, Use/Edit navigation, rebuild and extension decline with encrypted resource commands; returns null before App mode is configured.
 * [POS]: cloud/remote/resources' seam onto Apps, beside workflows.ts; the same per-App lifecycle lane a person here uses, so a remote open
 *        and a local one never interleave.
 */
import type { AppNavigationService } from "../../../apps/turn/app-navigation";
import type { AppResourcePort } from "./runtime";

export type RemoteAppNavigation = Pick<AppNavigationService, "openUseChatRemotely" | "latestEditorChat" | "editorAvailability">;
/** U06-d: the App service's remote build operations beside navigation. */
export type RemoteApps = RemoteAppNavigation & Pick<AppResourcePort, "disableImpact" | "setEnabled"> & Readonly<{ remoteRebuild(appId: string): void; declineExtension: AppResourcePort["declineExtension"] }>;

export const appResourcePort = (apps: () => RemoteApps | null) => (): AppResourcePort | null => {
  const current = apps();
  return current && {
    disableImpact: appId => current.disableImpact(appId),
    setEnabled: input => current.setEnabled(input),
    openUseChat: (appId, mode, requestId) => current.openUseChatRemotely(appId, mode, requestId),
    openEditor: appId => current.latestEditorChat(appId),
    rebuild: appId => current.remoteRebuild(appId),
    declineExtension: (appId, requestId, deviceName) => current.declineExtension(appId, requestId, deviceName),
  };
};
