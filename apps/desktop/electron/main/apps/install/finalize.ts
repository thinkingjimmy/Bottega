/**
 * [INPUT]: Depends on fs/path/crypto, AppManifest schema and Agent requests mechanical replacement
 * [OUTPUT]: Provides Web App finalizeInstall with the difference validate together with ManifestSemantics, base type bypasses the installer
 * [POS]: The manifest of apps/install, the kernel of the definitive closure, the pre-testing of candidate data, the mechanical replenishment and execution
 */

import { isAbsolute, win32 } from "node:path";
import type { AppManifest } from "../../../../shared/apps-ipc";
import { appManifestSchema } from "./manifest-schema";
import { completeAgentRequirements } from "./agent-requirements";

export type FinalizeHooks = {
  runInstall: (command: string) => Promise<void>;
  runBuild: (command: string) => Promise<void>;
  validateStatic: (manifest: AppManifest) => Promise<void>;
};

export function validateManifestSemantics(manifest: AppManifest) {
  if (manifest.kind === "base") return;
  if (manifest.kind === "static") {
    assertRelativePath(manifest.staticDir);
    return;
  }
  if (!manifest.startCmd.includes("{PORT}")) {
    throw new Error("server App 的 startCmd 必须包含 {PORT}");
  }
  if (manifest.serveTrigger) assertRelativePath(manifest.serveTrigger.watchPath);
  const serveFields = [
    manifest.serveAgentPrompt,
    manifest.serveTrigger,
    manifest.agentRequirements,
  ];
  const configured = serveFields.filter(Boolean).length;
  if (configured !== 0 && configured !== serveFields.length) {
    throw new Error(
      "serveAgentPrompt、serveTrigger 与 agentRequirements 必须同时存在或同时为 null"
    );
  }
}

export async function finalizeInstall(
  appDir: string,
  candidateManifest: unknown,
  hooks: FinalizeHooks
) {
  const parsed = appManifestSchema.parse(candidateManifest);
  if (parsed.kind === "base") {
    throw new Error("base App 不经 Web 安装器 finalize");
  }
  validateManifestSemantics(parsed);
  await hooks.runInstall(parsed.installCmd);
  if (parsed.buildCmd) await hooks.runBuild(parsed.buildCmd);
  const finalManifest = await completeAgentRequirements(parsed, appDir);
  if (finalManifest.kind === "static") {
    await hooks.validateStatic(finalManifest);
  }
  return finalManifest;
}

function assertRelativePath(value: string) {
  const segments = value.split(/[\\/]+/);
  if (isAbsolute(value) || win32.isAbsolute(value) || segments.includes("..")) {
    throw new Error(`manifest 路径不安全：${value}`);
  }
}
