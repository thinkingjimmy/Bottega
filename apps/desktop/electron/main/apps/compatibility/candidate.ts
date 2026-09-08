/**
 * [INPUT]: Depends on owned Git reads, bounded no-link source reads, package inspection and framed content digests.
 * [OUTPUT]: Captures installed candidate identity from HEAD and actual source bytes without parsing the edited manifest.
 * [POS]: Compatibility candidate reader; source-monitor fingerprints remain change hints, not resume authority.
 */
import { createHash } from "node:crypto";
import { lstat, readlink, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppRecord } from "../../../../shared/apps-ipc";
import { APP_COMPATIBILITY_FILE } from "../../../../shared/app-host/contract";
import { readCommandSource } from "../execution/source-file";
import { inspectPackage, isSafePackagePath, packageDigest } from "../share/package/package-contract";
import { framedValueDigest } from "../share/package/package-digest";
import { recordCandidate } from "./read";

export async function readWorkspaceCandidate(record: AppRecord, git: (args: string[]) => Promise<string>) {
  const root = await realpath(record.dir);
  const metadata = await optionalStat(join(root, ".git"));
  if (!metadata) {
    const sourceDigest = await packageDigest(root, (await inspectPackage(root)).files);
    return recordCandidate(record, framedValueDigest("bottega.app-candidate", 1, { commitSha: null, sourceDigest }));
  }
  const commitSha = (await git(["rev-parse", "--verify", "HEAD"])).trim();
  const tracked = await git(["ls-files", "--cached", "--recurse-submodules", "-z"]);
  const untracked = await git(["ls-files", "--others", "--exclude-standard", "-z"]);
  const paths = [...new Set([...tracked.split("\0"), ...untracked.split("\0"), "app.json", APP_COMPATIBILITY_FILE])]
    .filter((path) => path && !path.startsWith(".naming-product/")).sort();
  if (paths.length > 20_000) throw new Error("APP_CANDIDATE_SOURCE_TOO_LARGE");
  const files: unknown[] = [];
  let bytes = 0;
  for (const path of paths) {
    if (!isSafePackagePath(path)) throw new Error("APP_CANDIDATE_SOURCE_INVALID");
    const absolute = join(root, path);
    const info = await optionalStat(absolute);
    if (!info) { files.push({ path, kind: "missing" }); continue; }
    if (await realpath(dirname(absolute)) !== dirname(absolute)) throw new Error("APP_CANDIDATE_SOURCE_INVALID");
    if (info.isSymbolicLink()) {
      files.push({ path, kind: "symlink", target: await readlink(absolute) });
      continue;
    }
    bytes += info.size;
    if (bytes > 512 * 1024 * 1024) throw new Error("APP_CANDIDATE_SOURCE_TOO_LARGE");
    const source = await readCommandSource(root, path, 64 * 1024 * 1024);
    files.push({ path, executable: Boolean(info.mode & 0o111), digest: createHash("sha256").update(source.bytes).digest("hex") });
  }
  if ((await git(["rev-parse", "--verify", "HEAD"])).trim() !== commitSha) throw new Error("APP_CANDIDATE_CHANGED");
  return { ...recordCandidate(record, framedValueDigest("bottega.app-candidate", 1, { commitSha, files })), commitSha };
}

async function optionalStat(path: string) {
  try { return await lstat(path); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}
