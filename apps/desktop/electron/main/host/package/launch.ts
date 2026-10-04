/**
 * [INPUT]: Depends on the shared Seatbelt policy, canonical paths, foreign credential roots and pinned bundled Node.
 * [OUTPUT]: Provides fencePackageLaunch for package hosts and their main-sealed CLI launches; unsupported platforms fail closed.
 * [POS]: Shared OS boundary below HostPackageRuntime; a package never selects its own writable roots or environment.
 */
import { mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { buildSeatbeltProfile, spawnRuntimeReadAccess, withHostSandboxMarker } from "../../backends/sandbox/seatbelt";
import { canonicalPath, SANDBOX_EXEC, sbplString } from "../../backends/sandbox/sbpl";
import type { AgentProcessLaunch } from "../../backends/types";

export type PackageFence = {
  identity: string;
  providerId?: string;
  readRoots: readonly string[];
  writeRoots?: readonly string[];
  protectedRoots?: readonly string[];
  workspace?: string;
  readOnly?: boolean;
  network?: boolean;
  deniedReadRoots?: readonly string[];
  controlRoot?: string;
};

export function fencePackageLaunch(launch: AgentProcessLaunch, fence: PackageFence): AgentProcessLaunch {
  if (process.platform !== "darwin") throw Object.assign(new Error("package-sandbox-unsupported"), { code: "package-sandbox-unsupported" });
  const temp = join(tmpdir(), "bottega-package-runtime", createHash("sha256").update(fence.identity).digest("hex"));
  mkdirSync(temp, { recursive: true, mode: 0o700 });
  const access = spawnRuntimeReadAccess({ command: launch.command, args: [...launch.args] });
  const mode = fence.readOnly || !fence.workspace ? "read-only" : "workspace-write";
  const env = withHostSandboxMarker({ ...launch.env, TMPDIR: temp, TMP: temp, TEMP: temp }, mode);
  let profile = buildSeatbeltProfile({ purpose: "title", cwd: launch.cwd, sandboxRoot: fence.workspace ?? launch.cwd,
    sandbox: mode, readRoots: [...fence.readRoots], network: fence.network ?? false, toolPolicy: "none", ephemeral: true,
    prompt: "", approvalPolicy: "never", env: "user-default", ignoreUserConfig: true, timeoutMs: 30_000 }, {
    userHome: env.HOME ?? homedir(), tempDir: temp, childEnv: env, packageProviderId: fence.providerId,
    stateWriteRoots: [...(fence.writeRoots ?? [])], runtimeReadRoots: access.roots, runtimeReadFiles: access.files,
    protectedReadOnlyRoots: [...(fence.protectedRoots ?? []), ...access.roots],
    deniedReadRoots: fence.deniedReadRoots, readOnlyWorkspace: Boolean(fence.workspace && mode === "read-only"),
  });
  if (fence.controlRoot) {
    const control = canonicalPath(fence.controlRoot, "package control root");
    profile += `(deny file-write* (subpath ${sbplString(control)}))\n(deny file-write* (literal ${sbplString(dirname(control))}))\n`;
  }
  return { command: SANDBOX_EXEC, args: ["-p", profile, canonicalPath(launch.command, "package executable"), ...launch.args], cwd: launch.cwd, env };
}
