/**
 * [INPUT]: Depends on admitted Linux component identities, fixed read/write roots and framed compiler input
 * [OUTPUT]: Builds bubblewrap namespace arguments and a Landlock policy followed by the shared compiler frame
 * [POS]: Linux-only launch composition consumed by the native compiler supervisor
 */

import { access } from "node:fs/promises";
import type { LinuxSandboxIdentity } from "./locator";
import { encodeLinuxExecPolicy } from "./exec-policy";

export async function linuxCompilerLaunch(component: LinuxSandboxIdentity, input: Readonly<{
  nodeExecutable: string;
  compilerEntry: string;
  esbuildExecutable?: string;
  dependencyRoots: readonly string[];
  snapshotRoot: string;
  outputRoot: string;
  tempRoot: string;
  stdin: Buffer;
}>) {
  const readRoots = [component.execPolicy, input.nodeExecutable, input.compilerEntry, ...input.dependencyRoots,
    ...(input.esbuildExecutable ? [input.esbuildExecutable] : [])];
  const args = ["--die-with-parent", "--new-session", "--unshare-all", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"];
  for (const path of new Set(readRoots)) args.push("--ro-bind", path, path);
  for (const path of ["/usr/lib", "/usr/lib64", "/lib", "/lib64"]) {
    if (await access(path).then(() => true, () => false)) args.push("--ro-bind", path, path);
  }
  args.push("--ro-bind", input.snapshotRoot, input.snapshotRoot,
    "--bind", input.outputRoot, input.outputRoot, "--bind", input.tempRoot, input.tempRoot,
    "--chdir", input.tempRoot, "--", component.execPolicy, "--stdio-v1");
  return { command: component.executable, args, stdin: encodeLinuxExecPolicy(input, input.stdin) };
}
