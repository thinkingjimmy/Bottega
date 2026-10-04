/**
 * [INPUT]: Pinned official release metadata, resumable transport, tar parsing and system codesign.
 * [OUTPUT]: TunnelSupply, verifying both digests and Developer ID before publication and every execution, with read-only pinned version, executable digest and signer metadata.
 * [POS]: Shared preview/server supply; private immutable launch snapshots isolate executable paths from the update cache.
 */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdir, mkdtemp, open, readFile, rename, rmdir, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import pin from "../../../../resources/tunnel/runtime.json";
import { downloadResumable } from "./download";
import { extractExecutable } from "./archive";

const exec = promisify(execFile);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export async function verifyDeveloperId(path: string, teamId: string) {
  await exec("/usr/bin/codesign", ["--verify", "--strict", "-R", `=anchor apple generic and certificate leaf[subject.OU] = "${teamId}"`, path], { timeout: 15_000, maxBuffer: 65_536 });
  const { stderr } = await exec("/usr/bin/codesign", ["-dv", "--verbose=4", path], { timeout: 15_000, maxBuffer: 65_536 });
  if (!stderr.split("\n").includes(`TeamIdentifier=${teamId}`)) throw new Error("tunnel-signature-invalid");
}
export class TunnelSupply {
  readonly version = pin.version;
  readonly executableSha256 = pin.executableSha256;
  readonly teamId = pin.teamId;
  readonly supported = process.platform === pin.platform && process.arch === pin.architecture;
  private flight: Promise<void> | null = null;
  private readonly directory: string;
  readonly executable: string;
  constructor(userData: string, private readonly verify = verifyDeveloperId, private readonly fetcher: typeof fetch = fetch) {
    this.directory = join(userData, "tunnel-runtime", pin.version);
    this.executable = join(this.directory, "cloudflared");
  }
  async ensure(signal: AbortSignal) {
    if (!this.supported) throw new Error("tunnel-platform-unsupported");
    try { const file = await this.openVerified(); await file.close(); return; } catch { /* Reacquire a missing or untrusted installation. */ }
    if (!this.flight) this.flight = this.install(signal).finally(() => { this.flight = null; });
    await this.flight;
    signal.throwIfAborted();
  }
  async openVerified() {
    if (!this.supported) throw new Error("tunnel-platform-unsupported");
    const file = await open(this.executable, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await file.stat();
      if (!before.isFile() || before.size > pin.maximumExecutableBytes || (before.mode & 0o022)) throw new Error("tunnel-component-unverified");
      if (digest(await file.readFile()) !== pin.executableSha256) throw new Error("tunnel-component-unverified");
      await this.verify(this.executable, pin.teamId);
      const current = await open(this.executable, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const after = await current.stat(), held = await file.stat();
        if (after.ino !== before.ino || after.dev !== before.dev || held.mtimeMs !== before.mtimeMs || held.size !== before.size) throw new Error("tunnel-component-replaced");
      } finally { await current.close(); }
      return file;
    } catch (error) { await file.close(); throw error; }
  }
  async prepareLaunch() {
    const source = await this.openVerified();
    const directory = await mkdtemp(join(this.directory, "launch-")), path = join(directory, "cloudflared");
    const close = async () => {
      await chmod(directory, 0o700);
      await exec("/usr/bin/chflags", ["nouchg", path]).catch(() => undefined);
      await unlink(path).catch(() => undefined); await rmdir(directory);
    };
    try {
      const bytes = Buffer.alloc((await source.stat()).size);
      try {
        let offset = 0;
        while (offset < bytes.length) { const read = await source.read(bytes, offset, bytes.length - offset, offset); if (!read.bytesRead) throw new Error("tunnel-component-replaced"); offset += read.bytesRead; }
        if (digest(bytes) !== pin.executableSha256) throw new Error("tunnel-component-replaced");
        const copy = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o500);
        try { await copy.writeFile(bytes); await copy.sync(); } finally { await copy.close(); }
      } finally { bytes.fill(0); }
      await this.verify(path, pin.teamId);
      // Darwin cannot execute /dev/fd. Keep an immutable, non-writable private snapshot until the child exits.
      await exec("/usr/bin/chflags", ["uchg", path]); await chmod(directory, 0o500);
      return { path, close };
    } catch (error) { await close(); throw error; } finally { await source.close(); }
  }
  private async install(signal: AbortSignal) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const partial = join(this.directory, "download.partial"), staging = join(this.directory, `candidate-${randomUUID()}`);
    await downloadResumable(pin.url, partial, pin.maximumArchiveBytes, signal, this.fetcher);
    try {
      const archive = await readFile(partial);
      if (digest(archive) !== pin.archiveSha256) throw new Error("tunnel-component-unverified");
      const binary = extractExecutable(archive, pin.maximumExecutableBytes);
      if (digest(binary) !== pin.executableSha256) throw new Error("tunnel-component-unverified");
      const candidate = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o500);
      try { await candidate.writeFile(binary); await candidate.sync(); } finally { await candidate.close(); binary.fill(0); }
      await this.verify(staging, pin.teamId);
      signal.throwIfAborted();
      await rename(staging, this.executable);
      const check = await this.openVerified(); await check.close();
    } finally { await unlink(staging).catch(() => undefined); await unlink(partial).catch(() => undefined); }
  }
}
