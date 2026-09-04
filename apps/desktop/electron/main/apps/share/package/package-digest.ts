/**
 * [INPUT]: Depends on node:crypto SHA-256 and node:fs readFile
 * [OUTPUT]: Provides the framed content-addressing primitives: canonicalJson, framedValueDigest, framedTreeDigest, and the paired source/runtime tree digest
 * [POS]: The digest algebra behind apps/share/package; package-contract.ts decides what belongs in a projection while this file decides what a projection hashes to
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export function framedValueDigest(domain: string, version: number, value: unknown) {
  const hash = createHash("sha256");
  frame(hash, Buffer.from(domain, "utf8"));
  frame(hash, Buffer.from(String(version), "ascii"));
  frame(hash, Buffer.from(canonicalJson(value), "utf8"));
  return `sha256:${hash.digest("hex")}` as const;
}

type DigestFile = {
  path: string;
  kind?: "file" | "symlink";
  executable?: boolean;
  linkTarget?: string;
};

export async function framedTreeDigest(
  domain: string,
  version: number,
  root: string,
  files: readonly DigestFile[]
) {
  const hash = openTreeDigest(domain, version);
  for (const file of orderedByPath(files)) frames(hash, await fileFrames(root, file));
  return sealDigest(hash);
}

/**
 * source 投影恒包含 runtime 投影，且同路径条目是同一份。于是按路径序读一次盘
 * 就能同时喂两个域的哈希——两个域各自的帧序不变，摘要与分别计算完全相同。
 */
export async function framedTreePairDigest(
  root: string,
  source: readonly DigestFile[],
  runtime: readonly DigestFile[]
) {
  const sourceHash = openTreeDigest("ai-chat.app-source", 2);
  const runtimeHash = openTreeDigest("ai-chat.app-runtime", 2);
  const runtimePaths = new Set(runtime.map((file) => file.path));
  for (const file of orderedByPath(source)) {
    const parts = await fileFrames(root, file);
    frames(sourceHash, parts);
    if (runtimePaths.has(file.path)) frames(runtimeHash, parts);
  }
  return {
    sourcePackageDigest: sealDigest(sourceHash),
    contentDigest: sealDigest(runtimeHash),
  };
}

function openTreeDigest(domain: string, version: number) {
  const hash = createHash("sha256");
  frames(hash, [Buffer.from(domain, "utf8"), Buffer.from(String(version), "ascii")]);
  return hash;
}

const sealDigest = (hash: ReturnType<typeof createHash>) =>
  `sha256:${hash.digest("hex")}` as const;

const frames = (hash: ReturnType<typeof createHash>, parts: readonly Buffer[]) => {
  for (const part of parts) frame(hash, part);
};

const orderedByPath = <T extends { path: string }>(files: readonly T[]) =>
  [...files].sort((left, right) =>
    Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8"))
  );

/** 单文件的帧序列：算一次就能喂给任意多个域的哈希。 */
async function fileFrames(root: string, file: DigestFile): Promise<Buffer[]> {
  const head = [
    Buffer.from(file.path, "utf8"),
    Buffer.from(file.kind ?? "file", "ascii"),
  ];
  return file.kind === "symlink"
    ? [...head, Buffer.from(file.linkTarget ?? "", "utf8")]
    : [
        ...head,
        Buffer.from(file.executable ? "x" : "-", "ascii"),
        await readFile(join(root, file.path)),
      ];
}

function frame(hash: ReturnType<typeof createHash>, bytes: Buffer) {
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  hash.update(length);
  hash.update(bytes);
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    entries.sort(([left], [right]) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
