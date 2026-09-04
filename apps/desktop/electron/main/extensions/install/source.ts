/**
 * [INPUT]: Depends on git Fixed subprocesses, audited word paths for apps/share, canonical digest for registry-store and userData staging roots
 * [OUTPUT]: Provides fetchExtensionSource/discardStagedSource: partial no-checkout Freeze commit, pre-determined type and then sparse materialisation, source budget and provenance
 * [POS]: The remote supply chain mechanism of extensions/install; Just the question of "freeze which tree, which blob to read only bytes"
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, opendir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Sha256Digest } from "../../../../shared/extensions-ipc";
import { sanitizedProcessEnvironment } from "../../codex-runtime";
import { isSafePackagePath } from "../../apps/share/package/package-contract";
import { digestCanonical } from "../registry-store";
import type { ExtensionSourceProvenance } from "../registry-store";
import {
  AGENT_PLUGIN_ADAPTER_ID,
} from "../manifest-adapter";
import { SKILL_REPO_ADAPTER_ID } from "../skill-repo-adapter";
import type { ExtensionAdapterId } from "../admission";

/* Agent Plugins 1.0.0 的包布局是固定且浅的（plugin.json / skills/<name>/SKILL.md /
   mcp.json / 反向域名目录），因此预算比 App 包更紧：越界即拒，不做部分导入。 */
export const EXTENSION_PACKAGE_BUDGET = {
  files: 512,
  fileBytes: 1024 * 1024,
  totalBytes: 16 * 1024 * 1024,
  depth: 8,
} as const;

const EXTENSION_FETCH_BUDGET = {
  objectStoreBytes: 96 * 1024 * 1024,
  gitTimeoutMs: 60_000,
} as const;

export type ExtensionSourceRequest = Readonly<{
  repoUrl: string;
  /** 空串 = 默认分支；解析结果一律落成 immutable commit */
  requestedRef?: string;
  subdirectory?: string;
}>;

export type StagedExtensionSource = Readonly<{
  stagingId: string;
  stagingRoot: string;
  /** 传给 admitExtensionPackage 的包根（已含 subdirectory） */
  packageRoot: string;
  provenance: ExtensionSourceProvenance;
  contentDigest: Sha256Digest;
  adapterId: ExtensionAdapterId;
  files: readonly Readonly<{ path: string; bytes: number }>[];
}>;

type TreeEntry = Readonly<{
  mode: string;
  type: string;
  object: string;
  path: string;
}>;

export async function fetchExtensionSource(
  stagingBase: string,
  request: ExtensionSourceRequest
): Promise<StagedExtensionSource> {
  const subdirectory = normalizeSubdirectory(request.subdirectory);
  const stagingId = randomUUID();
  const stagingRoot = join(stagingBase, stagingId);
  const repository = join(stagingRoot, "repo");
  const packageRoot = join(stagingRoot, "package");
  await mkdir(repository, { recursive: true, mode: 0o700 });
  try {
    /* 永远不 checkout：untrusted 仓库的 hooks/filter 只在 checkout 时才有机会跑，
       而我们只需要对象库。ref 也不保留为可变名字，落账的只有 resolvedCommit。 */
    await git(
      [
        "clone",
        "--no-checkout",
        "--filter=blob:none",
        "--depth",
        "1",
        ...(request.requestedRef ? ["--branch", request.requestedRef] : []),
        request.repoUrl,
        ".",
      ],
      repository
    );
    await assertObjectStoreBudget(repository);
    const resolvedCommit = (await git(["rev-parse", "HEAD"], repository)).trim();
    const selectedTree = selectSubtree(
      parseTree(await git(["ls-tree", "-r", "-z", resolvedCommit], repository)),
      subdirectory
    );
    const adapterId = classifyTree(selectedTree, subdirectory);
    const entries =
      adapterId === SKILL_REPO_ADAPTER_ID
        ? selectedTree.filter((entry) => entry.path.startsWith("skills/"))
        : selectedTree;
    if (!entries.length) throw new Error("选定的 tree 为空或 subdirectory 不存在");
    assertSafeTree(entries);
    const files = await materialize(repository, packageRoot, entries);
    await assertObjectStoreBudget(repository);
    const provenance: ExtensionSourceProvenance = {
      normalizedUrl: request.repoUrl,
      requestedRef: request.requestedRef ?? "",
      resolvedCommit,
      subdirectory,
      treeDigest: digestCanonical(
        entries.map((entry) => [entry.mode, entry.object, entry.path])
      ),
      fetchedAt: Date.now(),
    };
    return {
      stagingId,
      stagingRoot,
      packageRoot,
      provenance,
      contentDigest: digestCanonical(files),
      adapterId,
      files: files.map(({ path, bytes }) => ({ path, bytes })),
    };
  } catch (cause) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw cause;
  }
}

function classifyTree(
  entries: readonly TreeEntry[],
  subdirectory: string
): ExtensionAdapterId {
  if (entries.some((entry) => entry.path === "plugin.json")) {
    return AGENT_PLUGIN_ADAPTER_ID;
  }
  const hasSkills = entries.some((entry) =>
    /^skills\/[^/]+\/SKILL\.md$/.test(entry.path)
  );
  if (!hasSkills) {
    throw new Error("扩展仓库既无 plugin.json 也未发现 skills/<name>/SKILL.md");
  }
  if (subdirectory) {
    throw new Error("skill-repo v1 不支持显式 subdirectory，请从仓库根安装");
  }
  return SKILL_REPO_ADAPTER_ID;
}

export function discardStagedSource(staged: Pick<StagedExtensionSource, "stagingRoot">) {
  return rm(staged.stagingRoot, { recursive: true, force: true });
}

/* subdirectory 只做词法归一：解码后的 `..`、绝对路径与空段一律拒，不靠 realpath
   事后补救——那时不安全的字节已经落盘了。 */
function normalizeSubdirectory(value: string | undefined) {
  const raw = (value ?? "").replace(/^\/+|\/+$/g, "");
  if (!raw) return "";
  const segments = raw.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`subdirectory 无效：${JSON.stringify(value)}`);
  }
  return segments.join("/");
}

function selectSubtree(entries: readonly TreeEntry[], subdirectory: string) {
  if (!subdirectory) return entries;
  const prefix = `${subdirectory}/`;
  return entries.flatMap((entry) =>
    entry.path.startsWith(prefix)
      ? [{ ...entry, path: entry.path.slice(prefix.length) }]
      : []
  );
}

function assertSafeTree(entries: readonly TreeEntry[]) {
  for (const entry of entries) {
    if (entry.mode === "120000" || entry.mode === "160000") {
      throw new Error(`扩展包拒绝 symlink/submodule：${entry.path}`);
    }
    if (entry.type !== "blob") throw new Error(`包条目不是 blob：${entry.path}`);
    /* 词法安全判据复用 App 包契约那份已审计的实现：控制字符、反斜杠、绝对路径与
       空/`.`/`..` 段的口径只能有一份，抄第二遍迟早漂移。 */
    if (!isSafePackagePath(entry.path)) {
      throw new Error(`扩展包路径无效：${JSON.stringify(entry.path)}`);
    }
    if (entry.path.split("/").length - 1 > EXTENSION_PACKAGE_BUDGET.depth) {
      throw new Error(`扩展包目录过深：${entry.path}`);
    }
  }
}

async function materialize(
  repository: string,
  packageRoot: string,
  entries: readonly TreeEntry[]
) {
  await mkdir(packageRoot, { recursive: true, mode: 0o700 });
  const files: Array<{ path: string; bytes: number; digest: Sha256Digest }> = [];
  let totalBytes = 0;
  for (const entry of entries) {
    if (files.length + 1 > EXTENSION_PACKAGE_BUDGET.files) {
      throw new Error("扩展包超过 512 文件或 16 MB 总预算");
    }
    const content = await gitBuffer(
      ["cat-file", "blob", entry.object],
      repository,
      EXTENSION_PACKAGE_BUDGET.fileBytes + 1
    );
    if (content.byteLength > EXTENSION_PACKAGE_BUDGET.fileBytes) {
      throw new Error(`扩展包文件超限：${entry.path}`);
    }
    totalBytes += content.byteLength;
    if (totalBytes > EXTENSION_PACKAGE_BUDGET.totalBytes) {
      throw new Error("扩展包超过 512 文件或 16 MB 总预算");
    }
    const target = join(packageRoot, entry.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, content, { mode: 0o400 });
    await chmod(target, 0o400);
    files.push({
      path: entry.path,
      bytes: content.byteLength,
      digest: digestCanonical(content.toString("base64")),
    });
  }
  return files;
}

function parseTree(output: string): TreeEntry[] {
  return output
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split("\t");
      const [mode, type, object] = (meta ?? "").trim().split(/\s+/);
      if (!mode || !type || !object || !path) {
        throw new Error("无法解析 git ls-tree 输出");
      }
      return { mode, type, object, path };
    });
}

function git(args: string[], cwd: string) {
  return gitBuffer(args, cwd, 32 * 1024 * 1024).then((value) =>
    value.toString("utf8")
  );
}

function gitBuffer(args: string[], cwd: string, maxBuffer: number) {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        env: sanitizedProcessEnvironment(),
        encoding: "buffer",
        maxBuffer,
        timeout: EXTENSION_FETCH_BUDGET.gitTimeoutMs,
        shell: false,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`git ${args[0]} 失败：${stderr.toString("utf8").trim()}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

async function assertObjectStoreBudget(repository: string) {
  const objects = join(repository, ".git", "objects");
  if ((await directoryBytes(objects)) > EXTENSION_FETCH_BUDGET.objectStoreBytes) {
    throw new Error("扩展仓库 Git 对象库超过 96 MB 取源预算");
  }
}

async function directoryBytes(root: string): Promise<number> {
  let bytes = 0;
  const directory = await opendir(root);
  for await (const entry of directory) {
    const path = join(root, entry.name);
    bytes += entry.isDirectory() ? await directoryBytes(path) : (await stat(path)).size;
    if (bytes > EXTENSION_FETCH_BUDGET.objectStoreBytes) return bytes;
  }
  return bytes;
}
