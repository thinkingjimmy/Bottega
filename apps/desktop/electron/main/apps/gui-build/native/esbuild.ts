/**
 * [INPUT]: The host esbuild package location and its platform-specific optional dependency.
 * [OUTPUT]: resolveEsbuildExecutable returns a native on-disk binary, independent of postinstall optimization.
 * [POS]: Shared App/plugin compiler launch resolver; no shell, PATH or environment fallback is admitted.
 */
import { closeSync, openSync, readSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { sep } from "node:path";

export function resolveEsbuildExecutable(packageFile: string, platform = process.platform, arch = process.arch): string {
  const specifier = `@esbuild/${platform}-${arch}/${platform === "win32" ? "esbuild.exe" : "bin/esbuild"}`;
  try {
    const resolved = createRequire(packageFile).resolve(specifier);
    const executable = realpathSync(resolved.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`));
    assertNative(executable, platform);
    return executable;
  } catch (cause) {
    throw new Error(`esbuild native executable (${platform}-${arch}) is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function assertNative(path: string, platform: NodeJS.Platform) {
  const file = openSync(path, "r"), header = Buffer.alloc(4);
  try { readSync(file, header, 0, 4, 0); } finally { closeSync(file); }
  const signatures: Partial<Record<NodeJS.Platform, readonly string[]>> = {
    darwin: ["cffaedfe", "feedfacf", "cafebabe", "bebafeca"], linux: ["7f454c46"], win32: ["4d5a"],
  };
  if (!signatures[platform]?.some(signature => header.toString("hex").startsWith(signature))) {
    throw new Error("Expected a native binary; scripts cannot run inside the compiler sandbox");
  }
}
