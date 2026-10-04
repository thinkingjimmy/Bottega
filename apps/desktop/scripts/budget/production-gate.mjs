/**
 * [INPUT]: Depends on node:child_process, the desktop's electron-vite build and check-budgets.mjs, and scripts/heavy-job (one heavy job on the machine at a time, at low priority).
 * [OUTPUT]: Builds with production inputs whatever the shell or CI environment says (BOTTEGA_CLOUD_BUILD is overridden, not inherited) into its own root out-budget/ (BOTTEGA_BUDGET_BUILD=1, so an E2E build in out/ survives), then runs the budget gate with `--production`, so preload and main surfaces are gated on the bytes that ship.
 * [POS]: The production byte gate (`pnpm budget:production`); release packaging reaches the same gate through its production build.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { runAsHeavyJob } from "../heavy-job/heavy-job.mjs";

await runAsHeavyJob("budget:production");

const desktop = resolve(import.meta.dirname, "..", "..");
/* Its own output root: building into out/ would replace an E2E build and force the next E2E step to rebuild. */
const env = { ...process.env, BOTTEGA_CLOUD_BUILD: "production", BOTTEGA_BUDGET_BUILD: "1" };
delete env.ELECTRON_RUN_AS_NODE;
for (const [command, args] of [["npx", ["electron-vite", "build"]], [process.execPath, ["scripts/budget/check-budgets.mjs", "--production", "--output-root", "out-budget"]]]) {
  const result = spawnSync(command, args, { cwd: desktop, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
