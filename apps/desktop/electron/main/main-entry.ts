/**
 * [INPUT]: Depends on Electron, the console-stream guard, the production-source identity bootstrap, the pre-lock profile wipe, the V8 compile-cache enabler and, in non-production builds only, the private entry built beside main.
 * [OUTPUT]: Starts the desktop composition root once identity is final, a requested profile erase has run, the compile cache is on and (non-production only) a private entry beside main has been loaded.
 * [POS]: Stable/production main entry; the staging flavour enters through cloud-dev-entry.ts instead.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { configureSourceDevelopment } from "./cloud/bootstrap/source-profile";
import { enableStartupCompileCache } from "./startup/boot/compile-cache";
import { guardConsoleStreams } from "./startup/boot/console-streams";
import { wipeRequestedProfile } from "./profile-maintenance/erase";
declare const __BOTTEGA_CLOUD_CONFIG__: import("@ai-chat/cloud-protocol").CloudBuildConfig | null;
declare const __BOTTEGA_PRIVATE_ENTRIES__: boolean;
guardConsoleStreams();
// Identity must be frozen before the single-instance lock, which index.ts takes as it evaluates.
if (__BOTTEGA_CLOUD_CONFIG__?.environmentId === "cloud-production") configureSourceDevelopment(app);
// An erase asked for by the previous run happens before anything below can open a file in userData.
wipeRequestedProfile(app.getPath("userData"));
enableStartupCompileCache(app);
// A non-production build may carry a private entry beside main that registers on the composition hooks before index
// composes; it decides for itself whether to register anything. A production bundle compiles this branch out.
if (__BOTTEGA_PRIVATE_ENTRIES__) {
  const privateEntry = join(__dirname, "e2e-entry.js");
  if (existsSync(privateEntry)) createRequire(__filename)(privateEntry);
}
void import("./index").catch((cause) => {
  console.error("[main] startup failed", cause);
  app.exit(1);
});
