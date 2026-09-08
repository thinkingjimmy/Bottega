/**
 * [INPUT]: Depends on admitted Web manifests and bounded no-link command source reads
 * [OUTPUT]: Collects every platform's explicitly declared script into the immutable source projection
 * [POS]: Package source leaf; static runtime output stays separate from rebuild scripts
 */

import { createHash } from "node:crypto";
import type { AppManifest } from "../../../../../shared/apps-ipc";
import { readCommandSource } from "../../execution/source-file";

export async function inspectDeclaredCommandSources(root: string, manifest: AppManifest) {
  if (manifest.kind === "base" || manifest.executionSchemaVersion !== 1) return [];
  const commands = [manifest.installCmd, manifest.buildCmd, ...(manifest.kind === "server" ? [manifest.startCmd] : [])];
  const scripts = new Map<string, string>();
  for (const command of commands) {
    if (!command || typeof command === "string") continue;
    const targets = "platforms" in command.target ? Object.values(command.target.platforms) : [command.target];
    for (const target of targets) {
      if (!target.script) continue;
      const previous = scripts.get(target.script.path);
      if (previous && previous !== target.script.sha256) throw changed();
      scripts.set(target.script.path, target.script.sha256);
    }
  }
  return Promise.all([...scripts].map(async ([path, digest]) => {
    const source = await readCommandSource(root, path, 1024 * 1024);
    if (`sha256:${createHash("sha256").update(source.bytes).digest("hex")}` !== digest) throw changed();
    return { path, bytes: source.bytes.length, kind: "file" as const, executable: false };
  }));
}

function changed() { return Object.assign(new Error("Declared App command source does not match its manifest"), { code: "APP_COMMAND_SOURCE_CHANGED" }); }
