/**
 * [INPUT]: Depends on updater event facts and platform-neutral progress/version values
 * [OUTPUT]: Provides updateAdapter and UpdateAdapterEvents for the UpdateService
 * [POS]: The dependency-inversion seam for real electron-updater and deterministic E2E adapters
 */

export type UpdateInfo = Readonly<{ version: string; operationId?: number }>;
export type DownloadProgress = Readonly<{
  operationId?: number;
  percent: number;
  transferred: number;
  total: number;
}>;

export type UpdateAdapterEvents = {
  "checking-for-update": () => void;
  "update-available": (info: UpdateInfo) => void;
  "update-not-available": (info: UpdateInfo) => void;
  "download-progress": (progress: DownloadProgress) => void;
  "update-downloaded": (info: UpdateInfo) => void;
  error: (error: Error & { operationId?: number }) => void;
};

export interface UpdateAdapter {
  on<K extends keyof UpdateAdapterEvents>(
    event: K,
    listener: UpdateAdapterEvents[K]
  ): void;
  off<K extends keyof UpdateAdapterEvents>(
    event: K,
    listener: UpdateAdapterEvents[K]
  ): void;
  checkForUpdates(operationId?: number): Promise<void>;
  downloadUpdate(operationId?: number): Promise<void>;
  validateDownloadedCandidate?(version?: string): Promise<boolean>;
  invalidateCandidate?(): void | Promise<void>;
  quitAndInstall(): void;
}
