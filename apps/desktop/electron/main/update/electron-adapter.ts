/**
 * [INPUT]: Depends on electron-updater loaded on first command (never at module evaluation), its command-scoped events and the version-bound candidate cache.
 * [OUTPUT]: Provides the production adapter with serial candidate invalidation and stale-event fencing.
 * [POS]: The only electron-updater import; native cache files remain under its existing lifecycle.
 */

import { EventEmitter } from "node:events";
import { CandidateCache } from "./candidate-cache";
import type { UpdateAdapter, UpdateInfo, DownloadProgress } from "./adapter";

type NativeUpdater = (typeof import("electron-updater"))["autoUpdater"];

/* electron-updater costs ~47 ms to evaluate while the first scheduled check is 30 s
   after launch; keeping it off the startup graph is worth one memoized promise. */
let nativeModule: Promise<NativeUpdater> | undefined;

function loadNativeUpdater() {
  /* Node ESM exposes this CJS package as `default` only; the bundled CJS output
     carries both. Reading through `default` is the shape both agree on. */
  nativeModule ??= import("electron-updater").then(
    (loaded) => (loaded.default ?? loaded).autoUpdater
  );
  return nativeModule;
}

export function createElectronUpdateAdapter(injected?: NativeUpdater): UpdateAdapter {
  const cache = new CandidateCache();
  const events = new EventEmitter();
  let epoch = 0;
  let availableVersion: string | null = null;
  let downloadedVersion: string | null = null;
  let downloading = false;
  let handedOff = false;
  /* quitAndInstall is synchronous and only reachable after a download, so the
     resolved updater is kept beside the promise instead of re-awaiting it. */
  let ready: NativeUpdater | undefined;
  let preparing: Promise<NativeUpdater> | undefined;

  function configure(nativeUpdater: NativeUpdater) {
    nativeUpdater.autoDownload = false;
    nativeUpdater.autoInstallOnAppQuit = false;
    nativeUpdater.autoRunAppAfterInstall = true;
    nativeUpdater.allowPrerelease = false;
    nativeUpdater.disableWebInstaller = true;
    // Command failures are observed through their promises. Only terminal native failures
    // have no returning command and must reach the service's force-exit boundary.
    nativeUpdater.on("error", (error) => { if (handedOff) events.emit("error", error); });
    ready = nativeUpdater;
    return nativeUpdater;
  }

  function native() {
    preparing ??= (injected ? Promise.resolve(injected) : loadNativeUpdater())
      .then(configure)
      .catch((cause) => { preparing = undefined; throw cause; });
    return preparing;
  }

  return {
    on(event, listener) { events.on(event, listener); },
    off(event, listener) { events.off(event, listener); },
    async checkForUpdates(requestId) {
      const operationId = ++epoch;
      const nativeUpdater = await native();
      const available = (info: UpdateInfo) => {
        if (operationId !== epoch) return;
        availableVersion = info.version;
        events.emit("update-available", { ...info, operationId: requestId ?? operationId });
      };
      const unavailable = (info: UpdateInfo) => {
        if (operationId !== epoch) return;
        availableVersion = null;
        events.emit("update-not-available", { ...info, operationId: requestId ?? operationId });
      };
      nativeUpdater.on("update-available", available);
      nativeUpdater.on("update-not-available", unavailable);
      try { await nativeUpdater.checkForUpdates(); }
      finally {
        nativeUpdater.off("update-available", available);
        nativeUpdater.off("update-not-available", unavailable);
      }
    },
    async downloadUpdate(requestId) {
      if (downloading || !availableVersion || handedOff) throw new Error("UPDATE_DOWNLOAD_NOT_ADMITTED");
      downloading = true;
      const version = availableVersion;
      const operationId = ++epoch;
      try {
        const nativeUpdater = await native();
        const progress = (value: DownloadProgress) => {
          if (operationId === epoch && downloading) events.emit("download-progress", { ...value, operationId: requestId ?? operationId });
        };
        const downloaded = (info: Parameters<CandidateCache["capture"]>[0]) => {
          if (operationId !== epoch || info.version !== version || !downloading) return;
          cache.capture(info);
          downloadedVersion = version;
          events.emit("update-downloaded", { version, operationId: requestId ?? operationId });
        };
        nativeUpdater.on("download-progress", progress);
        nativeUpdater.on("update-downloaded", downloaded);
        try { await nativeUpdater.downloadUpdate(); }
        finally {
          nativeUpdater.off("download-progress", progress);
          nativeUpdater.off("update-downloaded", downloaded);
        }
      } finally {
        downloading = false;
      }
    },
    async validateDownloadedCandidate(version) {
      return Boolean(version && version === downloadedVersion && await cache.valid(version));
    },
    invalidateCandidate() {
      if (downloading || handedOff) throw new Error("UPDATE_CANDIDATE_BUSY");
      ++epoch;
      availableVersion = null;
      downloadedVersion = null;
      cache.invalidate();
      // The next native check replaces its provider binding, and the next verified
      // download replaces its installer payload. No cache file is deleted here.
    },
    quitAndInstall() {
      if (handedOff || !ready || !downloadedVersion || downloadedVersion !== availableVersion) throw new Error("UPDATE_CANDIDATE_STALE");
      handedOff = true;
      ready.quitAndInstall(false, true);
    },
  } satisfies UpdateAdapter;
}
