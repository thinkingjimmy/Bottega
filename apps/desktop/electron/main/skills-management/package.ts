/**
 * [INPUT]: Depends on node fs (streaming reads and copyFile)/crypto/timers, strict frontmatter parsing, the optional discovery digest cache, and the shared SkillSlug admission gate, and statusError from main/errors
 * [OUTPUT]: Provides strict Skill directory inspection with admitted slug/requires metadata, per-file hashes from the same walk, deterministic filtered digesting/copying that never buffers a whole file in main, cooperative candidate discovery, and stable digest observation
 * [POS]: skills-management's untrusted-directory read boundary; size is reported, never a verdict — hard failure is reserved for symlinks, path escapes, and invalid names
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  opendir,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import type {
  ManagedSkillReason,
  ManagedSkillReasonCode,
} from "../../../shared/unified-skills-ipc";
import { statusError } from "../errors";
import { parseStrictSkillFrontmatter } from "../extensions/manifest-adapter";
import type { SkillDigestCache, SkillFileStat } from "./orchestration/digest-cache";
import { admitSkillSlug } from "./skill-slug";

/* ── 体积是信息，不是裁决 ────────────────────────────────────────
 * 从前这里有 MAX_FILES / MAX_TOTAL_BYTES 两条上限，撞上就整个否掉。
 * 可上游四家都只是「就地读」，凭什么我们替用户判一个插画 Skill 死刑？
 * 现在走目录只 lstat（本来就是），把 files/bytes 如实报出去，选不选由人定。
 *
 * 留下的两条只管遍历本身不失控：symlink 已被拒收，故不存在环，
 * MAX_DEPTH 管的是合法但荒唐的深树；MAX_DIRECTORIES 抬到跑飞才会撞。
 *
 * MAX_DIGEST_BYTES 是唯一的体积分界，而它不否任何东西：超过就先不算
 * 内容 digest（发现阶段要扫四家 HOME，不能为一个 659 MiB 的 .venv
 * 每次启动读一遍盘），等用户真的选中它，import 时再补算那一次。
 * ──────────────────────────────────────────────────────────────── */
const MAX_PREVIEW_BYTES = 128 * 1024;
const MAX_DIGEST_BYTES = 16 * 1024 * 1024;
const MAX_DIRECTORIES = 50_000;
const MAX_DEPTH = 32;
export type InspectedSkillFolder = Readonly<{
  canonicalPath: string;
  name: string;
  displayName: string;
  description: string;
  requires?: string;
  /* 超过 MAX_DIGEST_BYTES 时为 null：内容还没被读过，不是「没有内容」。
     verifyInspectedSkill 会在导入那一刻把它补齐。 */
  digest: `sha256:${string}` | null;
  revision: string;
  preview: string;
  bytes: number;
  /* `sha256` is present exactly when this walk hashed the bytes: publication
     reuses it instead of reading every file a second time. */
  files: readonly Readonly<{ path: string; bytes: number; sha256?: string }>[];
}>;

export type SkillFolderInspection =
  | Readonly<{ importable: true; skill: InspectedSkillFolder }>
  | Readonly<{ importable: false; name: string; reason: ManagedSkillReason; revision: string }>;

export type SkillFolderDigestObservation =
  | Readonly<{ kind: "present"; digest: `sha256:${string}` }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "unavailable" }>;

/**
 * `hashAll` 关掉体积分界。广扫四家 HOME 时不该开（那正是预算存在的理由），
 * 但对我们自己装进来的包目录要开：它们的 digest 是投影授权的凭据，
 * 缺了就没法与投影副本逐字节对账。
 *
 * `digestCache` belongs only to discovery scans: it answers "is this directory
 * still what it was last time". Once `hashAll` is true, this cell is the
 * byte-for-byte reconciliation itself, and the cache gets no say — unless the
 * caller explicitly declares this a periodic re-check (`trustCachedSignature`),
 * whose conclusion never authorizes any write. A cache hit carries no per-file
 * sha256.
 */
export type SkillInspectionOptions = Readonly<{
  hashAll?: boolean;
  digestCache?: SkillDigestCache;
  /** Only a periodic re-check of a directory this product itself wrote may set this. */
  trustCachedSignature?: boolean;
}>;

export async function inspectSkillFolder(
  path: string,
  options: SkillInspectionOptions = {}
): Promise<SkillFolderInspection> {
  const fallbackName = candidateLabel(path);
  try {
    return { importable: true, skill: await inspectSkillFolderStrict(path, options.hashAll === true,
      options.hashAll === true && options.trustCachedSignature !== true ? undefined : options.digestCache) };
  } catch (cause) {
    return {
      importable: false,
      name: fallbackName,
      reason: publicInspectionReason(cause),
      revision: `invalid:${fallbackName}`,
    };
  }
}

/** 账本校验不能把短暂 I/O 失败伪装成内容漂移。 */
export async function observeSkillFolderDigest(path: string): Promise<SkillFolderDigestObservation> {
  try {
    const root = await lstat(path);
    if (root.isSymbolicLink() || !root.isDirectory()) return { kind: "invalid" };
  } catch (cause) {
    return errorCode(cause) === "ENOENT" ? { kind: "missing" } : { kind: "unavailable" };
  }
  try {
    /* 这不是广扫，是对一个已知受管目标的定向复核：预算不适用，
       缺 digest 就当场算——否则大 Skill 的漂移永远发现不了。 */
    const inspected = await inspectSkillFolderStrict(path, true);
    return { kind: "present", digest: inspected.digest! };
  } catch (cause) {
    return cause instanceof SkillInspectionError ? { kind: "invalid" } : { kind: "unavailable" };
  }
}

export async function inspectPackageFolder(path: string) {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw invalid("not-a-directory");
    }
    const canonical = await realpath(path);
    const rootSkill = await lstat(join(canonical, "SKILL.md")).catch(() => null);
    if (rootSkill) return [await inspectSkillFolder(canonical)];
    const skillsRoot = join(canonical, "skills");
    const root = await lstat(skillsRoot).catch(() => null);
    if (!root || root.isSymbolicLink() || !root.isDirectory()) {
      /* 「这个文件夹不是 Skill」是一条候选事实，不是一次操作失败：
         抛出去只会变成一条通用红条，返回来则能在弹窗里指名道姓。 */
      return [{ importable: false, name: basename(canonical), reason: { code: "missing-skill-md" }, revision: "invalid:layout" } satisfies SkillFolderInspection];
    }
    const inspections: SkillFolderInspection[] = [];
    const directory = await opendir(skillsRoot);
    for await (const entry of directory) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (inspections.length >= MAX_DIRECTORIES) {
        inspections.push({ importable: false, name: "remaining candidates", reason: { code: "too-many-candidates" }, revision: "invalid:candidate-budget" });
        break;
      }
      inspections.push(await inspectSkillFolder(join(skillsRoot, entry.name)));
    }
    return inspections.sort((left, right) => inspectionName(left).localeCompare(inspectionName(right)));
  } catch (cause) {
    throw new SkillInspectionError(publicInspectionReason(cause));
  }
}

export async function scanAgentSkillsRoot(root: string, options: SkillInspectionOptions = {}) {
  const metadata = await lstat(root).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return null;
    throw cause;
  });
  if (!metadata) return [];
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    return [{ importable: false, name: basename(root), reason: { code: "not-a-directory" }, revision: "invalid:root" } satisfies SkillFolderInspection];
  }
  const results: SkillFolderInspection[] = [];
  const directory = await opendir(root);
  for await (const entry of directory) {
    if (entry.name.startsWith(".ai-chat-")) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (results.length >= MAX_DIRECTORIES) {
      results.push({ importable: false, name: "remaining candidates", reason: { code: "too-many-candidates" }, revision: "invalid:candidate-budget" });
      break;
    }
    results.push(await inspectSkillFolder(join(root, entry.name), options));
    /* One folder can be thousands of files; discovery runs on the main thread and
       must never hold it for the whole root. */
    await yieldToEventLoop();
  }
  return results.sort((left, right) => inspectionName(left).localeCompare(inspectionName(right)));
}

/**
 * 导入前的复核，也是超预算 Skill 补算 digest 的唯一时机：发现阶段为了不读盘
 * 而留空的那一格，在用户真的选中它之后补上——一次，且是他自己要的那一次。
 *
 * 变没变，digest 说了算：revision 里掺着根目录 mtime，而 mtime 是全世界
 * 最容易被无关进程碰一下的东西。内容身份在场时用内容身份，revision 只在
 * digest 缺席（超预算未哈希）时兜底——否则「摸过但没改」也会翻成 409。
 */
export async function verifyInspectedSkill(
  skill: InspectedSkillFolder
): Promise<InspectedSkillFolder & { digest: `sha256:${string}` }> {
  const current = await inspectSkillFolder(skill.canonicalPath);
  const unchanged = current.importable && (skill.digest
    ? current.skill.digest === skill.digest
    : current.skill.revision === skill.revision);
  if (!current.importable || !unchanged) {
    throw statusError(409, "Skill 候选在预览后已变化，请重新打开预览");
  }
  const digest = current.skill.digest ?? await digestWalk(current.skill.canonicalPath, current.skill.files);
  return { ...current.skill, digest };
}

/* ── 定向对账不吃发现预算 ────────────────────────────────────────
 * MAX_DIGEST_BYTES 属于「广扫四家 HOME」的世界：那里不读盘是美德。
 * copy 与定向复核的世界正相反——它们的全部意义就是逐字节对账，
 * 这里省下的每一次哈希都会变成一个 digest=null，而 null 不等于任何
 * 期望值：一个 682 MiB 的合法 Skill 于是在导入的每一道关卡上假装
 * 「被人改过」，永远 409。预算适用范围错了，不是预算太小。 */
export async function copySkillDirectory(
  source: string,
  target: string,
  expectedDigest?: `sha256:${string}`
) {
  const inspected = await inspectSkillFolder(source, { hashAll: true });
  if (!inspected.importable) throw new SkillInspectionError(inspected.reason);
  if (expectedDigest && inspected.skill.digest !== expectedDigest) {
    throw changedDuringCopy();
  }
  try {
    await mkdir(target, { recursive: false, mode: 0o700 });
    for (const file of inspected.skill.files) {
      const destination = join(target, file.path);
      const location = relative(target, destination);
      if (location.startsWith("..") || isAbsolute(location)) throw invalid("unsafe-path");
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      /* copyFile hands the bytes to the kernel: a 16 MiB Skill file used to become a
         16 MiB Buffer on the main-process heap before a single byte reached disk. */
      await copyFile(join(source, file.path), destination);
      await chmod(destination, 0o400);
    }
    const copied = await inspectSkillFolder(target, { hashAll: true });
    if (!copied.importable || copied.skill.digest !== inspected.skill.digest || (expectedDigest && copied.skill.digest !== expectedDigest)) {
      throw changedDuringCopy();
    }
    return copied.skill;
  } catch (cause) {
    await rm(target, { recursive: true, force: true }).catch(() => undefined);
    throw cause;
  }
}

/**
 * `digestCache` turns a periodic "is this still the generation we published"
 * check into a stat comparison; omit it whenever the answer authorizes a write.
 */
export async function digestSkillFolder(path: string, digestCache?: SkillDigestCache) {
  const inspected = await inspectSkillFolder(path, { hashAll: true, digestCache, trustCachedSignature: Boolean(digestCache) });
  return inspected.importable ? inspected.skill.digest : null;
}

async function inspectSkillFolderStrict(
  path: string,
  hashAll = false,
  digestCache?: SkillDigestCache
): Promise<InspectedSkillFolder> {
  const rootStat = await lstat(path);
  if (rootStat.isSymbolicLink()) throw invalid("symlink");
  if (!rootStat.isDirectory()) throw invalid("not-a-directory");
  const canonicalPath = await realpath(path);
  const { files: walked, total } = await walkSafe(canonicalPath);
  const skillFile = walked.find((file) => file.path === "SKILL.md");
  if (!skillFile) throw invalid("missing-skill-md");
  /* 这条限的是「正文要整篇送进 renderer 当预览」，与目录体积无关，
     故主语只有 SKILL.md 一个，码名就该这么叫。 */
  if (skillFile.bytes > MAX_PREVIEW_BYTES) throw invalid("skill-md-too-large");
  const content = await readFile(join(canonicalPath, "SKILL.md"), "utf8");
  const parsed = parseFrontmatter(content);
  if (!admitSkillSlug(parsed.name).ok) {
    throw invalid("invalid-name");
  }
  const hashed = hashAll || total <= MAX_DIGEST_BYTES
    ? await digestOf(canonicalPath, walked, digestCache)
    : null;
  const digest = hashed?.digest ?? null;
  return {
    canonicalPath,
    name: parsed.name,
    displayName: parsed.name,
    description: parsed.description,
    ...(parsed.requires ? { requires: parsed.requires } : {}),
    digest,
    revision: revisionOf(rootStat, walked, total, digest),
    preview: content,
    bytes: total,
    files: walked.map(({ path: filePath, bytes }, index) => ({
      path: filePath,
      bytes,
      ...(hashed?.files ? { sha256: hashed.files[index]! } : {}),
    })),
  };
}

function inspectionName(inspection: SkillFolderInspection) {
  return inspection.importable ? inspection.skill.name : inspection.name;
}

/* ── 机器态不是 Skill 的内容 ────────────────────────────────────
 * 这一格从前只挡 `.DS_Store`，理由是：Finder 写的元数据让 digest 在
 * 「打开过文件夹」与「没打开过」之间漂移，而那是同一个 Skill。
 *
 * 同一条理由适用于整张单子。`.venv` 里烤死的是本机绝对路径，
 * `node_modules` 是一次 install 的产物，`__pycache__` 是上次解释器的心情——
 * 它们既不是 Skill 的身份，也不该被复制到另一家的目录里去（复制过去
 * 本来就是坏的：路径对不上，谁也用不了）。
 *
 * 这一行同时管三件事，因为它们本就共用这一次遍历的产物：
 *   清单（files/bytes）· 摘要（digestWalk）· 复制（copySkillDirectory）
 * 三者同源，才谈得上「写进去的和算过的是同一份」。
 *
 * 实测代价：一个装了 680MB `.venv` 的 Skill，一次目录摘要 1991ms；
 * 而 Skills 页每次打开要对 (Skill × Agent) 全表做这件事。
 * 名单保持保守——只收机器毫无争议自己生成的那几个，
 * `dist` / `build` 这类可能真是 Skill 内容的名字一律不收。
 * ────────────────────────────────────────────────────────────── */
const EXCLUDED_ENTRIES = new Set([
  ".DS_Store", ".git", "node_modules", "__pycache__",
  ".venv", "venv", ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache",
]);

async function walkSafe(root: string) {
  /* mtimeMs rides along for the digest cache only; the inspection still publishes
     nothing but path and bytes. */
  const files: SkillFileStat[] = [];
  let total = 0;
  let directories = 0;
  const visit = async (directory: string, depth: number): Promise<void> => {
    directories += 1;
    if (directories > MAX_DIRECTORIES || depth > MAX_DEPTH) {
      throw invalid("too-many-directories");
    }
    const handle = await opendir(directory);
    for await (const entry of handle) {
      if (EXCLUDED_ENTRIES.has(entry.name)) continue;
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) throw invalid("symlink", relative(root, path));
      const canonical = await realpath(path);
      const location = relative(root, canonical);
      if (location.startsWith("..") || isAbsolute(location)) throw invalid("unsafe-path");
      if (metadata.isDirectory()) {
        await visit(path, depth + 1);
        continue;
      }
      if (!metadata.isFile()) throw invalid("unsafe-path", location);
      total += metadata.size;
      files.push({ path: location, bytes: metadata.size, mtimeMs: metadata.mtimeMs });
    }
  };
  await visit(root, 0);
  return { files: files.sort((left, right) => left.path.localeCompare(right.path)), total };
}

async function digestOf(
  root: string,
  files: readonly SkillFileStat[],
  cache: SkillDigestCache | undefined
) {
  const cached = cache?.lookup(root, files);
  if (cached) return { digest: cached, files: null };
  const walked = await digestWalkDetailed(root, files);
  cache?.remember(root, files, walked.digest);
  return walked;
}

/* 同样的字节序：路径 · \0 · 内容 · \0。内容改为按块喂给 hash——整份读进来
   只是为了立刻喂给同一个 hash，却让主进程为一个 MAX_DIGEST_BYTES 大小的
   文件凭空多背一份 16 MiB 的 Buffer。digest 逐字节不变。 */
async function digestWalk(root: string, files: readonly { path: string }[]) {
  return (await digestWalkDetailed(root, files)).digest;
}

/* Each file feeds two hashes at once: the directory identity and its own sha256.
   Publication would otherwise have to read the same bytes again to compute
   sha256; this pass finishes it along the way for free. */
async function digestWalkDetailed(root: string, files: readonly { path: string }[]) {
  const hash = createHash("sha256");
  const perFile: string[] = [];
  for (const file of files) {
    hash.update(file.path, "utf8");
    hash.update("\0");
    const fileHash = createHash("sha256");
    for await (const chunk of createReadStream(join(root, file.path))) {
      hash.update(chunk as Buffer);
      fileHash.update(chunk as Buffer);
    }
    hash.update("\0");
    perFile.push(fileHash.digest("hex"));
  }
  return { digest: `sha256:${hash.digest("hex")}` as const, files: perFile as readonly string[] };
}

/* digest 缺席时，「变没变」由文件数 + 总字节 + 根 mtime 承担。它比内容哈希弱，
   但这一格本就只用来判断「预览之后有没有被人动过」，而不是内容身份。 */
function revisionOf(
  stat: Awaited<ReturnType<typeof lstat>>,
  files: readonly unknown[],
  total: number,
  digest: string | null
) {
  return `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${files.length}:${total}:${digest ?? "unhashed"}`;
}

class SkillInspectionError extends Error {
  constructor(readonly reason: ManagedSkillReason) {
    /* message 只喂 main 日志；给用户的那一半在 renderer 的目录里。 */
    super(`skill-inspection:${reason.code}`);
  }
}

function invalid(code: ManagedSkillReasonCode, detail?: string) {
  return new SkillInspectionError(detail ? { code, detail } : { code });
}

function parseFrontmatter(content: string) {
  try {
    return parseStrictSkillFrontmatter(content);
  } catch {
    throw invalid("invalid-frontmatter");
  }
}

function publicInspectionReason(cause: unknown): ManagedSkillReason {
  if (cause instanceof SkillInspectionError) return cause.reason;
  const code = errorCode(cause);
  if (code === "ENOENT") return { code: "missing" };
  if (code === "EACCES" || code === "EPERM") return { code: "unreadable" };
  if (code === "ENOTDIR") return { code: "not-a-directory" };
  if (code === "ELOOP") return { code: "symlink" };
  return { code: "unknown" };
}

function errorCode(cause: unknown) {
  return (cause as NodeJS.ErrnoException | null)?.code;
}

function candidateLabel(path: string) {
  const normalized = path.replace(/\\/g, "/");
  return basename(normalized).slice(0, 100) || "skill";
}

function changedDuringCopy() {
  return statusError(409, "Skill 来源在复制期间发生变化，请重新预览");
}
