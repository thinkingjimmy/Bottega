/**
 * [INPUT]: Depends on Node fs/zlib/crypto/path, the audited package-path predicate, the extension package budget, the canonical digest, the host manifest name and the trust signature-file reader
 * [OUTPUT]: Provides stageLocalExtensionSource (a locally built host package, as a directory or a .tgz, staged into the same StagedExtensionSource the GitHub fetcher produces, its bottega.signature.json split off and parsed strictly) and readBoundedTarGz
 * [POS]: The restricted unpacker for host packages: file count, per-file and total bytes, depth, path safety, duplicate and case-colliding paths, and link/device members are all refused before a byte is written
 */
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { isSafePackagePath } from "../../apps/share/package/package-contract";
import { digestCanonical } from "../registry/registry-canonical";
import { EXTENSION_PACKAGE_BUDGET, type StagedExtensionSource } from "../install/source";
import { HOST_PACKAGE_ADAPTER_ID, HOST_PACKAGE_MANIFEST } from "./manifest";
import { takeSignatureFile } from "../trust/signature-file";

type Member = { path: string; bytes: Buffer };
const fail = (message: string): never => { throw new Error(`宿主包解包被拒：${message}`); };

/* ============================================================
 * Minimal ustar reader: regular files, directories and pax path
 * records only. The gzip layer is capped with maxOutputLength,
 * so a compression bomb fails before it is expanded.
 * ============================================================ */
export function readBoundedTarGz(archive: Buffer): Member[] {
  const budget = EXTENSION_PACKAGE_BUDGET;
  if (archive.byteLength > budget.totalBytes) fail("压缩包超过总预算");
  let tar: Buffer;
  try { tar = gunzipSync(archive, { maxOutputLength: budget.totalBytes + 1024 * (budget.files * 3 + 4) }); }
  catch (cause) { return fail(`无法解压或解压后超出预算（${(cause as Error).message}）`); }
  const members: Member[] = [];
  let offset = 0, paxPath: string | null = null;
  const text = (start: number, length: number) => tar.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const sizeField = text(offset + 124, 12).trim();
    if (!/^[0-7]*$/.test(sizeField)) fail("成员大小字段无效");
    const size = parseInt(sizeField || "0", 8), type = String.fromCharCode(header[156] || 48);
    const body = offset + 512, next = body + Math.ceil(size / 512) * 512;
    if (next > tar.byteLength) fail("成员越过归档末尾");
    const name = text(offset, 100), prefix = text(offset + 345, 155);
    if (type === "x") {
      const record = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(tar.subarray(body, body + size).toString("utf8"));
      paxPath = record ? record[1]! : null;
    } else if (type === "g") {
      // Pax attributes for the whole archive carry no member paths; nothing to apply.
    } else if (type === "0" || type === "5") {
      const path = paxPath ?? (prefix ? `${prefix}/${name}` : name);
      paxPath = null;
      if (type === "0") {
        if (size > budget.fileBytes) fail(`文件过大：${path}`);
        members.push({ path, bytes: Buffer.from(tar.subarray(body, body + size)) });
      }
    } else {
      fail(`不接受链接、设备或其他特殊成员（类型 ${JSON.stringify(type)}）：${name}`);
    }
    offset = next;
  }
  /* macOS tar stores extended attributes as AppleDouble `._name` members (and zip tools add `__MACOSX/`): metadata, not package content. */
  const content = members.filter(member => !/(?:^|\/)(?:\._[^/]*|__MACOSX)(?:\/|$)/.test(member.path));
  members.length = 0; members.push(...content);
  /* npm pack wraps everything in package/; strip one common top directory. */
  const top = members[0]?.path.split("/")[0];
  const wrapped = top && members.every(member => member.path.startsWith(`${top}/`));
  return members.map(member => ({ ...member, path: (wrapped ? member.path.slice(top!.length + 1) : member.path).replace(/^\.\//, "") }));
}

async function readDirectory(root: string): Promise<Member[]> {
  const members: Member[] = [];
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory)) {
      const path = join(directory, entry), info = await lstat(path);
      const rel = relative(root, path).split(sep).join("/");
      if (info.isSymbolicLink()) fail(`不接受符号链接：${rel}`);
      if (info.isDirectory()) { await walk(path); continue; }
      if (!info.isFile()) fail(`不接受特殊文件：${rel}`);
      if (info.size > EXTENSION_PACKAGE_BUDGET.fileBytes) fail(`文件过大：${rel}`);
      if (members.length >= EXTENSION_PACKAGE_BUDGET.files) fail("文件数超过预算");
      members.push({ path: rel, bytes: await readFile(path) });
    }
  };
  await walk(root);
  return members;
}

function assertMembers(members: Member[]) {
  const budget = EXTENSION_PACKAGE_BUDGET, seen = new Set<string>();
  let total = 0;
  if (members.length > budget.files) fail("文件数超过预算");
  for (const member of members) {
    if (!isSafePackagePath(member.path)) fail(`路径无效：${JSON.stringify(member.path)}`);
    if (member.path.split("/").length - 1 > budget.depth) fail(`目录过深：${member.path}`);
    /* Case-folded: on a case-insensitive volume two names would land on one file after digesting both. */
    const key = member.path.normalize("NFC").toLowerCase();
    if (seen.has(key)) fail(`路径重复或仅大小写不同：${member.path}`);
    seen.add(key);
    total += member.bytes.byteLength;
    if (total > budget.totalBytes) fail("总大小超过预算");
  }
}

/** A locally built host package: a directory, or a .tgz as `npm pack` writes it. Only the host-package family is accepted. */
export async function stageLocalExtensionSource(stagingBase: string, source: string): Promise<StagedExtensionSource> {
  const info = await lstat(source);
  const members = info.isDirectory() ? await readDirectory(source)
    : info.isFile() && /\.(?:tgz|tar\.gz)$/.test(source) ? readBoundedTarGz(await readFile(source)) : fail("只接受目录或 .tgz");
  assertMembers(members);
  /* The signature is not package content: it is split off before anything is written or digested, so the staged tree is what it signs. */
  const { members: content, signature } = takeSignatureFile(members);
  const manifest = content.find(member => member.path === HOST_PACKAGE_MANIFEST) ?? fail(`缺少 ${HOST_PACKAGE_MANIFEST}`);
  let packageId: unknown;
  try { packageId = (JSON.parse(manifest.bytes.toString("utf8")) as { packageId?: unknown }).packageId; } catch { packageId = null; }
  if (typeof packageId !== "string" || !/^[a-z][a-z0-9.-]{0,127}$/.test(packageId)) fail("manifest 缺少合法的 packageId");
  const stagingId = randomUUID(), stagingRoot = join(stagingBase, stagingId), packageRoot = join(stagingRoot, "package");
  try {
    const files = [];
    for (const member of [...content].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
      const target = join(packageRoot, member.path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, member.bytes, { mode: 0o400, flag: "wx" });
      await chmod(target, 0o400);
      files.push({ path: member.path, bytes: member.bytes.byteLength, digest: digestCanonical(member.bytes.toString("base64")) });
    }
    const contentDigest = digestCanonical(files);
    return { stagingId, stagingRoot, packageRoot, contentDigest, adapterId: HOST_PACKAGE_ADAPTER_ID, signature,
      files: files.map(({ path, bytes }) => ({ path, bytes })),
      /* Identity follows the declared packageId, so a rebuilt package updates the same install. */
      provenance: { normalizedUrl: `bottega-local://${packageId as string}`, requestedRef: "", resolvedCommit: contentDigest,
        subdirectory: "", treeDigest: digestCanonical(files.map(file => [file.path, file.digest])), fetchedAt: Date.now() } };
  } catch (cause) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw cause;
  }
}
