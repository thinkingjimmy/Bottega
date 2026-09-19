/**
 * [INPUT]: Depends on Electron, the production-source identity bootstrap and the V8 compile-cache enabler.
 * [OUTPUT]: Starts the desktop composition root once identity and the compile cache are final.
 * [POS]: Stable/production main entry; the staging flavour enters through cloud-dev-entry.ts instead.
 */
import { app } from "electron";
import { configureSourceDevelopment } from "./cloud/bootstrap/source-profile";
import { enableStartupCompileCache } from "./startup/compile-cache";
declare const __BOTTEGA_CLOUD_CONFIG__: import("@ai-chat/cloud-protocol").CloudBuildConfig | null;
// Identity must be frozen before the single-instance lock, which index.ts takes as it evaluates.
if (__BOTTEGA_CLOUD_CONFIG__?.environmentId === "cloud-production") configureSourceDevelopment(app);
enableStartupCompileCache(app);
void import("./index").catch((cause) => {
  console.error("[main] startup failed", cause);
  app.exit(1);
});
