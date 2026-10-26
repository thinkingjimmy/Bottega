/**
 * [INPUT]: Vite, installed Node development headers, macOS Command Line Tools and the native Keychain policy source.
 * [OUTPUT]: keychainPolicy(), a build plugin emitting keychain-policy.node beside the main entry.
 * [POS]: Shared main-build native compilation for development, stable and production; no runtime downloads or credential access.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

function nodeHeaders() {
  for (const directory of [resolve(dirname(process.execPath), "../include/node"), "/usr/local/include/node", "/opt/homebrew/include/node"]) {
    if (existsSync(join(directory, "node_api.h"))) return directory;
  }
  throw new Error("node_api.h not found; the Keychain policy needs Node development headers");
}

export function keychainPolicy(): Plugin {
  const source = fileURLToPath(new URL("../../resources/security/keychain-policy.c", import.meta.url));
  return {
    name: "noninteractive-keychain-policy",
    buildStart() {
      if (process.platform !== "darwin") return;
      this.addWatchFile(source);
      const temporary = mkdtempSync(join(tmpdir(), "bottega-keychain-build-"));
      try {
        const binary = join(temporary, "keychain-policy.node");
        execFileSync("/usr/bin/xcrun", ["clang", "-arch", "arm64", "-arch", "x86_64", "-O2", "-Werror", "-Wno-deprecated-declarations",
          "-mmacosx-version-min=12.0", "-DNAPI_VERSION=8", "-I", nodeHeaders(), "-bundle", "-undefined", "dynamic_lookup",
          "-framework", "Security", source, "-o", binary], { stdio: "pipe", timeout: 30_000 });
        this.emitFile({ type: "asset", fileName: "keychain-policy.node", source: readFileSync(binary) });
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    },
  };
}
