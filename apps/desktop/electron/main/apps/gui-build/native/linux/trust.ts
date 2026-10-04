/**
 * [INPUT]: Depends on release-authenticated Ubuntu package identities and Node no-follow file handles
 * [OUTPUT]: Provides strict Linux payload contracts, root-owned component verification, and release-pinned product launcher inspection
 * [POS]: Compiler Linux trust leaf; runtime observations can match release facts but cannot create them
 */

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, posix } from "node:path";
import { z } from "zod";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const packageVersion = z.string().regex(/^[0-9][a-zA-Z0-9.+:~-]{0,100}$/);
const artifact = z.object({ sha256: digest, bytes: z.number().int().positive().max(1024 * 1024) }).strict();
const STABLE_PROFILE_TEMPLATE = "# Bottega fixed compiler namespace launcher.\nabi <abi/4.0>,\ninclude <tunables/global>\n\nprofile bottega-{payload_id} /opt/bottega/runtime/bwrap/{payload_id}/bwrap flags=(unconfined) {\n  userns,\n}\n";
export const linuxPayloadSchema = z.object({
  schema: z.literal("bottega.compiler-linux-payload/v1"),
  payloadId: z.string().regex(/^bwrap-[a-f0-9]{64}$/),
  distribution: z.object({ id: z.literal("ubuntu"), version: z.literal("24.04"), architecture: z.literal("x64") }).strict(),
  package: z.object({
    name: z.literal("bubblewrap"), version: packageVersion, architecture: z.literal("amd64"),
    url: z.string().regex(/^https:\/\/archive\.ubuntu\.com\/ubuntu\/pool\/main\/b\/bubblewrap\/bubblewrap_[^/]+_amd64\.deb$/),
    sha256: digest, bytes: z.number().int().positive().max(1024 * 1024),
    archiveKey: z.literal("F6ECB3762474EDA9D21B7022871920D1991BC93C"),
    inReleaseSha256: digest, packagesSha256: digest,
  }).strict(),
  binary: artifact,
  execPolicy: artifact,
  system: z.object({ path: z.literal("/usr/bin/bwrap") }).strict(),
  stable: z.object({ profile: artifact }).strict(),
}).strict().refine((value) => value.payloadId === linuxPayloadId(value.binary.sha256), "payload identity mismatch");

export type LinuxPayload = z.infer<typeof linuxPayloadSchema>;
export type TrustedBytes = Readonly<{ bytes: Buffer; sha256: string; identity: string }>;
export type InspectTrustedFile = (path: string, maximum: number, executable?: boolean) => Promise<TrustedBytes>;

export function stablePaths(payload: LinuxPayload) {
  const root = `/opt/bottega/runtime/bwrap/${payload.payloadId}`;
  const profileName = `bottega-${payload.payloadId}`;
  return { root, binary: `${root}/bwrap`, profileName, profile: `/etc/apparmor.d/${profileName}` };
}

/** Rejecting writable ancestors also rejects ACL write access through the group mask. */
export async function assertRootOwnedPath(path: string): Promise<void> {
  if (!posix.isAbsolute(path) || posix.normalize(path) !== path || await realpath(path) !== path) {
    throw new Error("Linux component path is not canonical");
  }
  let current = path;
  while (true) {
    const info = await lstat(current);
    if (info.uid !== 0 || (info.mode & 0o022) !== 0 || info.isSymbolicLink() ||
        (current !== path && !info.isDirectory())) throw new Error("Linux component path is writable or unowned");
    if (current === "/") return;
    current = dirname(current);
  }
}

export const inspectTrustedFile: InspectTrustedFile = async (path, maximum, executable = false) => {
  await assertRootOwnedPath(path);
  const result = await inspectProductFile(path, maximum, executable);
  await assertRootOwnedPath(path);
  return result;
};

/** Product launchers may live in an AppImage mount; their release digest supplies admission. */
export const inspectProductFile: InspectTrustedFile = async (path, maximum, executable = false) => {
  if (!posix.isAbsolute(path) || posix.normalize(path) !== path || await realpath(path) !== path) {
    throw new Error("Linux product path is not canonical");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || (before.mode & 0o7022n) !== 0n ||
        (executable && (before.mode & 0o111n) === 0n) || before.size <= 0n || before.size > BigInt(maximum)) {
      throw new Error("Linux component file contract is invalid");
    }
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const linked = await lstat(path, { bigint: true });
    const stamp = (info: typeof before) => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.mode}:${info.uid}:${info.nlink}`;
    if (length !== Number(before.size) || stamp(before) !== stamp(after) || stamp(after) !== stamp(linked)) {
      throw new Error("Linux component changed while reading");
    }
    if (await realpath(path) !== path) throw new Error("Linux product path changed while reading");
    const bytes = buffer.subarray(0, length);
    return { bytes, sha256: sha256(bytes), identity: `${path}:${stamp(after)}` };
  } finally { await handle.close(); }
};

export function sha256(bytes: Uint8Array) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

export function verifyArtifact(actual: TrustedBytes, expected: LinuxPayload["binary"]) {
  if (actual.bytes.length !== expected.bytes || actual.sha256 !== expected.sha256) throw new Error("Linux component digest does not match the release");
}

export function stableProfile(payload: Pick<LinuxPayload, "payloadId">) {
  return STABLE_PROFILE_TEMPLATE.replaceAll("{payload_id}", payload.payloadId);
}

function linuxPayloadId(binaryDigest: string) {
  return `bwrap-${sha256(Buffer.from(`bottega.compiler-linux-component/v1\n${binaryDigest}\n${STABLE_PROFILE_TEMPLATE}`)).slice(7)}`;
}
