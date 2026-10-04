/**
 * [INPUT]: Depends on Filesystem executable identity, streaming SHA-256, adapter package content and measurement contracts.
 * [OUTPUT]: Provides HOST_PROBE_VERSION, MeasurementRuntimeChanged and measurementIdentity; validates the version's file identity before and after hashing native/adapter content.
 * [POS]: Measurement identity authority; changed binaries, versions or probe contracts invalidate stored evidence.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createReadStream, existsSync } from "node:fs";
import type { MeasurementIdentity } from "@ai-chat/cloud-protocol/contracts/provider";
import { executableIdentity, runtimeIdentityKey, sameIdentity } from "../../backends/runtime/availability/runtime";
import type { ResolvedRuntime } from "../../backends/types";

/* Bump when any probe's method or verdict rule changes, so earlier records stop counting. */
/* 4: the version, digest and probe must describe the same executable. */
export const HOST_PROBE_VERSION = "host-probe/4";
export class MeasurementRuntimeChanged extends Error {
  constructor() { super("measurement-runtime-changed"); }
}

/** sha256 over the adapter's package.json and entry file: the pinned version and the code Bottega actually starts. */
export async function adapterPackageDigest(entry: string) {
  let root = dirname(entry);
  while (!existsSync(join(root, "package.json")) && dirname(root) !== root) root = dirname(root);
  const hash = createHash("sha256");
  hash.update(await readFile(join(root, "package.json")));
  hash.update("\u0000");
  hash.update(await readFile(entry));
  return `sha256:${hash.digest("hex")}`;
}

export async function measurementIdentity(runtime: ResolvedRuntime, adapterEntry?: string): Promise<MeasurementIdentity> {
  const binary = await executableIdentity(runtime.executable);
  if (runtime.versionIdentity !== runtimeIdentityKey(binary)) throw new MeasurementRuntimeChanged();
  const cliIdentity = `${binary.realpath}#${binary.dev}:${binary.ino}:${Math.trunc(binary.mtimeMs)}:${binary.size}`;
  const digest = createHash("sha256");
  if (!adapterEntry) for await (const chunk of createReadStream(binary.realpath)) digest.update(chunk);
  const packageDigest = adapterEntry ? await adapterPackageDigest(adapterEntry) : `sha256:${digest.digest("hex")}`;
  if (!sameIdentity(binary, await executableIdentity(runtime.executable))) throw new MeasurementRuntimeChanged();
  return { cliIdentity: cliIdentity.slice(-512), cliVersion: runtime.version.slice(0, 64), packageDigest,
    probeVersion: HOST_PROBE_VERSION };
}
