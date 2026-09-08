/**
 * [INPUT]: Depends on root-owned util-linux flock, coreutils cat, and a stable component lock inode
 * [OUTPUT]: Acquires a cross-Host shared kernel lease that drains on stdin EOF or Host death
 * [POS]: Linux compiler component lifetime guard; the privileged installer takes the matching exclusive lock before profile reload
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { assertRootOwnedPath, inspectTrustedFile } from "./trust";

type LinuxComponentLease = Readonly<{ assertHeld(): void; release(): Promise<void> }>;

export async function acquireLinuxComponentLease(path: string): Promise<LinuxComponentLease> {
  await assertRootOwnedPath(path);
  const before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1 || before.size !== 0) throw new Error("Invalid Linux component lock");
  await Promise.all([
    inspectTrustedFile("/usr/bin/flock", 1024 * 1024, true),
    inspectTrustedFile("/usr/bin/cat", 1024 * 1024, true),
  ]);
  const nonce = `${randomUUID()}\n`;
  const child = spawn("/usr/bin/flock", ["--shared", "--nonblock", path, "/usr/bin/cat"], {
    stdio: ["pipe", "pipe", "pipe"], env: { LANG: "C", PATH: "/usr/bin:/bin" },
  });
  let held = false;
  let released = false;
  let failure: Error | null = null;
  child.stdin.on("error", () => undefined);
  child.stderr.resume();
  const closed = new Promise<void>((resolve) => child.once("close", () => { held = false; resolve(); }));
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("Linux component lease timed out")), 2000);
      child.once("error", (cause) => { failure = cause; clearTimeout(timer); reject(cause); });
      child.once("close", () => { clearTimeout(timer); reject(new Error("Linux component lease was denied")); });
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        if (output === nonce) { held = true; clearTimeout(timer); resolve(); }
        else if (output.length >= nonce.length) {
          failure = new Error("Unexpected Linux component lease response");
          held = false;
          clearTimeout(timer);
          reject(failure);
          child.stdin.destroy();
        }
      });
      child.stdin.write(nonce);
    });
    const after = await lstat(path);
    if (before.dev !== after.dev || before.ino !== after.ino) throw new Error("Linux component lock was replaced");
    await assertRootOwnedPath(path);
  } catch (cause) {
    child.stdin.destroy();
    child.kill();
    await closed;
    throw cause;
  }
  return {
    assertHeld() { if (!held || released || failure) throw new Error("Linux component lease is no longer held"); },
    async release() {
      if (released) return;
      released = true;
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 2000);
      try { await closed; } finally { clearTimeout(timer); }
    },
  };
}
