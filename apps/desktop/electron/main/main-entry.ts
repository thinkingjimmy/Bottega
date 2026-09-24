/**
 * [INPUT]: Depends on Electron, the production-source identity bootstrap, the pre-lock profile wipe and the V8 compile-cache enabler.
 * [OUTPUT]: Starts the desktop composition root once identity is final, a requested profile erase has run and the compile cache is on.
 * [POS]: Stable/production main entry; the staging flavour enters through cloud-dev-entry.ts instead.
 */
import { app } from "electron";
import { configureSourceDevelopment } from "./cloud/bootstrap/source-profile";
import { enableStartupCompileCache } from "./startup/compile-cache";
import { wipeRequestedProfile } from "./profile-maintenance/erase";
declare const __BOTTEGA_CLOUD_CONFIG__: import("@ai-chat/cloud-protocol").CloudBuildConfig | null;
// Identity must be frozen before the single-instance lock, which index.ts takes as it evaluates.
if (__BOTTEGA_CLOUD_CONFIG__?.environmentId === "cloud-production") configureSourceDevelopment(app);
// An erase asked for by the previous run happens before anything below can open a file in userData.
wipeRequestedProfile(app.getPath("userData"));
enableStartupCompileCache(app);
void import("./index").catch((cause) => {
  console.error("[main] startup failed", cause);
  app.exit(1);
});
