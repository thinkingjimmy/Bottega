/**
 * [INPUT]: Depends on admitted manifests, structured command semantics and mechanical Agent requirement completion
 * [OUTPUT]: Publishes admitted configuration requirements before executing; Provides one deterministic Web install/build validation path for author declarations and explicit Agent candidates
 * [POS]: apps/install's finalize step; the last checkpoint before an installed App's manifest is admitted
 */

import type { AppCommand } from "../../../../shared/apps-execution";
import { commandUsesPort } from "../execution/command";
import { isAbsolute, win32 } from "node:path";
import type { AppManifest } from "../../../../shared/apps-ipc";
import { appManifestSchema } from "./manifest-schema";
import { completeAgentRequirements } from "./agent-requirements";

type FinalizeHooks = {
  onManifest?: (manifest: Exclude<AppManifest, { kind: "base" }>) => Promise<unknown>;
  runInstall: (command: AppCommand) => Promise<void>;
  runBuild: (command: AppCommand) => Promise<void>;
  validateStatic: (manifest: AppManifest) => Promise<void>;
};

export function validateManifestSemantics(manifest: AppManifest) {
  if (manifest.kind === "base") return;
  if (manifest.kind === "static") {
    assertRelativePath(manifest.staticDir);
    return;
  }
  if (!commandUsesPort(manifest.startCmd)) {
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
  await hooks.onManifest?.(parsed);
  if (parsed.installCmd) await hooks.runInstall(parsed.installCmd);
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
