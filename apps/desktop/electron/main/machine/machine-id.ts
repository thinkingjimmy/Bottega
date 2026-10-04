/**
 * [INPUT]: Depends on Node crypto/child_process/fs/os, one platform hardware identifier read and the durable publication helpers.
 * [OUTPUT]: Provides `machineIdFor(purpose)` (per-purpose value over a process-lifetime cached root), `deriveMachineId`, `resolveMachineIdHash` (the root), `readPlatformMachineId` and `machineIdFile`.
 * [POS]: The one machine key beneath separate Project hints and cloud device/folder ownership; profile, userData, account and environment never enter it, the raw hardware id never leaves this process, and a new key is an app-keyed HMAC of it (an existing file keeps its value).
 */
import { execFile } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { durableReplaceFile, isErrnoCode, syncDirectory } from "../persistence/durable-json";

const MACHINE_ID_HASH = /^[a-f0-9]{64}$/;
/* Version 2 stores only the root the purposes are derived from; a version 1 file (one shared value) no longer parses and is
   replaced, which makes this computer a new device once (G-14; no migration, per the historical-data rule). */
const savedSchema = z.object({ version: z.literal(2), root: z.string().regex(MACHINE_ID_HASH) });
/* A hardware read is a process spawn on two of three platforms: it may be slow, and on a locked-down
   machine it may never answer. Nothing waits on it longer than this, because a stable random key is a
   better answer than a blocked folder open. */
const READ_TIMEOUT_MS = 3_000;
const IO_PLATFORM_UUID = /"IOPlatformUUID"\s*=\s*"([^"]+)"/;
const MACHINE_GUID = /MachineGuid\s+REG_SZ\s+(\S+)/i;
/* A bare SHA-256 of the hardware UUID is the same value any other app computes from it (G-14); keying it to
   Bottega keeps the answer stable per computer while it means nothing outside this product. */
const MACHINE_KEY = "bottega.machine-id/v1";

export type MachineIdPorts = {
  platform?: NodeJS.Platform;
  /** The user's home, never userData: a profile, a channel or a reinstall must not change the answer. */
  home?: string;
  exec?: (file: string, args: readonly string[], signal: AbortSignal) => Promise<string>;
  readText?: (path: string, signal: AbortSignal) => Promise<string>;
  random?: () => string;
  timeoutMs?: number;
};

/** macOS/Linux `~/.bottega/machine-id.json`, Windows `%USERPROFILE%\.bottega\machine-id.json`. */
export const machineIdFile = (home: string) => join(home, ".bottega", "machine-id.json");

const run = promisify(execFile);
const runCommand = async (file: string, args: readonly string[], signal: AbortSignal) =>
  (await run(file, [...args], { signal, timeout: READ_TIMEOUT_MS, maxBuffer: 256 * 1024, windowsHide: true })).stdout;
const readTextFile = (path: string, signal: AbortSignal) => readFile(path, { encoding: "utf8", signal });
// An absolute path, so no PATH entry can answer for the registry.
const registryTool = () => join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");

/** The raw hardware identifier. It is hashed by the only caller and is never persisted or transmitted. */
export async function readPlatformMachineId(ports: MachineIdPorts = {}, signal = AbortSignal.timeout(READ_TIMEOUT_MS)) {
  const platform = ports.platform ?? process.platform;
  const exec = ports.exec ?? runCommand, readText = ports.readText ?? readTextFile;
  if (platform === "darwin")
    return IO_PLATFORM_UUID.exec(await exec("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], signal))?.[1]?.trim() || null;
  if (platform === "win32")
    return MACHINE_GUID.exec(await exec(registryTool(), ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid", "/reg:64"], signal))?.[1]?.trim() || null;
  if (platform === "linux") return (await readText("/etc/machine-id", signal)).trim() || null;
  return null;
}

async function readSaved(path: string) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) return null;
    return savedSchema.parse(JSON.parse(await readFile(path, "utf8"))).root;
  } catch { return null; }
}

/** Create-if-absent, so two profiles launching together converge on one key instead of overwriting each other. */
async function persist(path: string, hash: string) {
  const directory = dirname(path), text = JSON.stringify({ version: 2, root: hash }) + "\n";
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await mkdir(directory, { mode: 0o700, recursive: true });
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
    try { await link(temporary, path); await syncDirectory(directory); return hash; }
    catch (error) {
      if (!isErrnoCode(error, "EEXIST")) throw error;
      // Whoever wrote first owns the machine's answer; unreadable bytes are replaced rather than left to flip it every launch.
      const existing = await readSaved(path);
      if (existing) return existing;
      await durableReplaceFile(path, text);
      return hash;
    } finally { await unlink(temporary).catch(() => undefined); }
  } catch { return null; }
}

async function firstAnswer(ms: number, read: (signal: AbortSignal) => Promise<string | null>) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, ms); });
  try { return await Promise.race([read(controller.signal).catch(() => null), expiry]); }
  finally { clearTimeout(timer); }
}

/**
 * One stable key per physical computer. The persisted file wins outright, so the value cannot change
 * between launches; a machine that refuses to name itself (restricted account, container) gets a random
 * key persisted in the same place, which still answers the only question asked: same computer as before?
 */
export async function resolveMachineIdHash(ports: MachineIdPorts = {}): Promise<string> {
  const path = machineIdFile(ports.home ?? homedir());
  const saved = await readSaved(path);
  if (saved) return saved;
  const hardware = await firstAnswer(ports.timeoutMs ?? READ_TIMEOUT_MS, signal => readPlatformMachineId(ports, signal));
  const hash = createHmac("sha256", MACHINE_KEY).update(hardware || (ports.random ?? (() => randomBytes(32).toString("hex")))()).digest("hex");
  return await persist(path, hash) ?? hash;
}

/** What a machine identity is for: each gets its own value, so one cannot be correlated with or replayed as another (G-14). */
export type MachinePurpose = "project-hints" | "cloud";
export const deriveMachineId = (root: string, purpose: MachinePurpose) => createHmac("sha256", root).update(`bottega.machine/${purpose}/v1`).digest("hex");

let cached: Promise<string> | null = null;
/** Lazy on purpose: the first folder open or device registration pays for the read, startup never does. */
export function machineIdFor(purpose: MachinePurpose) {
  return async () => deriveMachineId(await (cached ??= resolveMachineIdHash()), purpose);
}
