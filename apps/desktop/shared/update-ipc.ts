/**
 * [INPUT]: Depends on serializable update/application metadata and the shared platform capability matrix
 * [OUTPUT]: Provides UPDATE_CHANNEL, UpdateSnapshot, platform-aware AppInfo, and UpdateBridgeApi
 * [POS]: The shared update contract between main, preload, and renderer; updater implementation details never cross IPC, and product identity never enters it — that truth is renderer-side and lives once in src/lib/brand.ts
 */

import type { PlatformCapabilities } from "./platform-capabilities";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "not-available"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export type UpdateProgress = Readonly<{
  percent: number;
  transferred: number;
  total: number;
}>;

export type UpdateSnapshot = Readonly<{
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  progress: UpdateProgress | null;
  checkedAt: number | null;
  error: string | null;
  lastError: string | null;
  automaticInstall: boolean;
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
  downloadAndInstall: "update:download-and-install",
  appInfo: "update:app-info",
} as const;

export type UpdateBridgeApi = {
  snapshot(): Promise<UpdateSnapshot>;
  check(): Promise<UpdateSnapshot>;
  downloadAndInstall(): Promise<UpdateSnapshot>;
  appInfo(): Promise<AppInfo>;
  onChanged(callback: (snapshot: UpdateSnapshot) => void): () => void;
};
