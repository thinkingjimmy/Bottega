/**
 * [INPUT]: Depends on serializable update/application metadata and the shared platform capability matrix
 * [OUTPUT]: Provides uPDATE_CHANNEL, UpdateSnapshot, platform-aware AppInfo, and UpdateBridgeApi
 * [POS]: The shared update contract between main, preload, and renderer; updater implementation details never cross IPC, and product identity never enters it — that truth is renderer-side and lives once in src/lib/brand.ts
 */

import type { AppCompatibilityFailure } from "./app-host/contract";
import type { PlatformCapabilities } from "./platform-capabilities";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "not-available"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

export type UpdateProgress = Readonly<{
  percent: number;
  transferred: number;
  total: number;
}>;

export type AppUpdateRequirement = Readonly<{
  context: AppCompatibilityFailure;
  status: "waiting-download" | "checking" | "satisfied" | "unavailable" | "install-busy" | "error";
}>;

export type UpdateSnapshot = Readonly<{
  revision?: number;
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  progress: UpdateProgress | null;
  checkedAt: number | null;
  error: string | null;
  lastError: string | null;
  automaticInstall: boolean;
  candidateId?: string | null;
  appRequirement?: AppUpdateRequirement | null;
}>;

export type AppInfo = Readonly<{
  version: string;
  electron: string;
  platform: NodeJS.Platform;
  platformSupport: PlatformCapabilities;
  licenseText: string | null;
  licenseUrl: string;
}>;

export const UPDATE_CHANNEL = {
  snapshot: "update:snapshot",
  subscribe: "update:subscribe",
  check: "update:check",
  checkForApp: "update:check-for-app",
  dismissAppRequirement: "update:dismiss-app-requirement",
  downloadAndInstall: "update:download-and-install",
  installNow: "update:install-now",
  appInfo: "update:app-info",
} as const;

export type UpdateBridgeApi = {
  snapshot(): Promise<UpdateSnapshot>;
  check(): Promise<UpdateSnapshot>;
  checkForApp(requestId: string): Promise<UpdateSnapshot>;
  dismissAppRequirement(): Promise<UpdateSnapshot>;
  downloadAndInstall(): Promise<UpdateSnapshot>;
  installNow(candidateId: string): Promise<UpdateSnapshot>;
  appInfo(): Promise<AppInfo>;
  onChanged(callback: (snapshot: UpdateSnapshot) => void): () => void;
};
