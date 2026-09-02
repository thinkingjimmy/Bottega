/**
 * [INPUT]: Depends on shared Workspace Index/path Budget, projects/git/git-runner and Node opendir/lstat/path
 * [OUTPUT]: Provides canonical POSIX path, validation, 8MB retained index, three stage bounded Git NUL flow, walk list and fresh single path member/entity proof
 * [POS]: The Workspace indexing mechanism layer of Electron main; In Git/walk, the listing and directory derivatives execute raw/retained/count/byte upper limits, and the catalog only has caches, sequences and identity fence
 */

import { lstat, opendir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  WORKSPACE_DIRECTORY_INDEX_LIMIT,
  WORKSPACE_FILE_GIT_TIMEOUT_MS,
  WORKSPACE_FILE_INDEX_LIMIT,
  WORKSPACE_FILE_PATH_BYTE_LIMIT,
} from "../../shared/workspace-files-ipc";
import {
  GitCommandError,
  runGit,
  runGitNulRecords,
} from "./projects/git/git-runner";

const WALK_DEPTH_LIMIT = 12;
const WALK_VISIT_SLACK = 2;
export const WORKSPACE_INDEX_PATH_BYTE_LIMIT = 8 * 1024 * 1024;
/**
 * `-t --stage -z` 最坏 framing：`X 100644 ${64-byte oid} 3\t${path}\0`；
 * unmerged 同路径最多重复 stage 1/2/3。raw 流只保留一条 record remainder，
 * 三倍 byte/record 上限是主动终止线，不是一次性 stdout buffer。
 */
const GIT_STAGE_RECORD_OVERHEAD_BYTES = 77;
const GIT_STAGE_MULTIPLICITY = 3;
const GIT_RETAINED_RECORD_LIMIT =
  WORKSPACE_FILE_INDEX_LIMIT + WORKSPACE_DIRECTORY_INDEX_LIMIT;
export const WORKSPACE_GIT_INDEX_RAW_RECORD_LIMIT =
  GIT_STAGE_MULTIPLICITY * GIT_RETAINED_RECORD_LIMIT;
export const WORKSPACE_GIT_INDEX_RAW_OUTPUT_BYTE_LIMIT =
  GIT_STAGE_MULTIPLICITY *
  (WORKSPACE_INDEX_PATH_BYTE_LIMIT +
    GIT_RETAINED_RECORD_LIMIT * GIT_STAGE_RECORD_OVERHEAD_BYTES);
const WORKSPACE_GIT_INDEX_RAW_RECORD_BYTE_LIMIT =
  WORKSPACE_FILE_PATH_BYTE_LIMIT + GIT_STAGE_RECORD_OVERHEAD_BYTES;
const EXCLUDED_DIRECTORIES = new Set([
  "node_modules", ".git", "dist", "out", "build", ".next", "target",
  "vendor", "__pycache__", ".venv", "coverage",
]);

export type WorkspaceIndexedEntry = {
  path: string;
  entryKind: "file" | "dir";
};

export type WorkspaceIndexLimits = { files: number; directories: number };

type WorkspaceEnumerationBudgets = Readonly<{
  pathBytes?: number;
  /** 只允许缩小默认 raw ceiling，供 deterministic 边界回归使用。 */
  gitRawOutputBytes?: number;
}>;

export type WorkspaceListResult = {
  entries: WorkspaceIndexedEntry[];
  fileTruncated: boolean;
  directoryTruncated: boolean;
};

export type WorkspaceEntryMetadata = {
  kind: "file" | "dir";
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
};

type WorkspaceBuiltIndex = WorkspaceListResult & { pathBytes: number };

function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function validWorkspaceRelativePath(path: string) {
  if (
    !path ||
    Buffer.byteLength(path, "utf8") > WORKSPACE_FILE_PATH_BYTE_LIMIT ||
    isAbsolute(path) ||
    hasControlCharacter(path) ||
    path.includes("\\")
  ) return false;
  return path.split("/").every(
    (segment) => segment !== "" && segment !== "." && segment !== ".."
  );
}

const notGitRepository = (cause: unknown) =>
  cause instanceof GitCommandError &&
  /not a git repository/i.test(cause.detail.stderr ?? cause.message);

export async function defaultIsGitRepository(workspace: string) {
  try {
    return (
      await runGit(workspace, ["rev-parse", "--is-inside-work-tree"], {
        timeoutMs: WORKSPACE_FILE_GIT_TIMEOUT_MS,
      })
    ).trim() === "true";
  } catch (cause) {
    if (notGitRepository(cause)) return false;
    throw cause;
  }
}

function parseGitFileEntry(record: string): WorkspaceIndexedEntry | null {
  if (record.startsWith("? ")) {
    const path = record.slice(2);
    return validWorkspaceRelativePath(path)
      ? { path, entryKind: "file" }
      : null;
  }
  const separator = record.indexOf("\t");
  const header = separator < 0 ? "" : record.slice(0, separator);
  const match = /^[A-Z] ([0-7]{6}) [0-9a-f]{40,64} [0-3]$/.exec(header);
  const path = separator < 0 ? "" : record.slice(separator + 1);
  if (!match || !validWorkspaceRelativePath(path)) return null;
  return {
    path,
    entryKind: match[1] === "160000" ? "dir" : "file",
  };
}

export function parseGitFileEntries(output: string): WorkspaceIndexedEntry[] {
  const entries: WorkspaceIndexedEntry[] = [];
  const seen = new Set<string>();
  for (const record of output.split("\0")) {
    const entry = parseGitFileEntry(record);
    if (!entry) continue;
    const key = `${entry.entryKind}:${entry.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      entries.push(entry);
    }
  }
  return entries;
}

function normalizedEntry(
  entry: string | WorkspaceIndexedEntry
): WorkspaceIndexedEntry | null {
  const normalized = typeof entry === "string"
    ? { path: entry, entryKind: "file" as const }
    : entry;
  return validWorkspaceRelativePath(normalized.path) &&
    (normalized.entryKind === "file" || normalized.entryKind === "dir")
    ? normalized
    : null;
}

export function buildWorkspaceIndex(
  rawEntries: readonly (string | WorkspaceIndexedEntry)[],
  limits: WorkspaceIndexLimits,
  listedTruncation: Pick<
    WorkspaceListResult,
    "fileTruncated" | "directoryTruncated"
  >,
  pathByteLimit = WORKSPACE_INDEX_PATH_BYTE_LIMIT
): WorkspaceBuiltIndex {
  const files: WorkspaceIndexedEntry[] = [];
  const directories: WorkspaceIndexedEntry[] = [];
  const filePaths = new Set<string>();
  const directoryPaths = new Set<string>();
  let pathBytes = 0;
  let fileTruncated = listedTruncation.fileTruncated;
  let directoryTruncated = listedTruncation.directoryTruncated;
  let byteTruncated = false;
  const reserve = (path: string) => {
    const bytes = Buffer.byteLength(path, "utf8");
    if (pathBytes + bytes > pathByteLimit) {
      byteTruncated = true;
      fileTruncated = true;
      directoryTruncated = true;
      return false;
    }
    pathBytes += bytes;
    return true;
  };
  for (const rawEntry of rawEntries) {
    const entry = normalizedEntry(rawEntry);
    if (!entry || entry.entryKind !== "file" || filePaths.has(entry.path)) continue;
    if (files.length >= limits.files) {
      fileTruncated = true;
      continue;
    }
    if (!reserve(entry.path)) break;
    filePaths.add(entry.path);
    files.push(entry);
  }
  const addDirectories = (start: string) => {
    let path = start;
    while (path !== ".") {
      if (directoryPaths.has(path)) return true;
      if (directories.length >= limits.directories) {
        directoryTruncated = true;
        return false;
      }
      if (!reserve(path)) return false;
      directoryPaths.add(path);
      directories.push({ path, entryKind: "dir" });
      path = dirname(path);
    }
    return true;
  };
  if (!byteTruncated) {
    for (const rawEntry of rawEntries) {
      const entry = normalizedEntry(rawEntry);
      if (entry?.entryKind === "dir" && !addDirectories(entry.path)) break;
    }
  }
  if (!byteTruncated) {
    for (const file of files) {
      if (!addDirectories(dirname(file.path))) break;
    }
  }
  return {
    entries: [...files, ...directories],
    pathBytes,
    fileTruncated,
    directoryTruncated,
  };
}

async function gitFiles(
  workspace: string,
  limits: WorkspaceIndexLimits,
  pathByteLimit: number,
  rawOutputByteLimit: number
): Promise<WorkspaceListResult> {
  const entries: WorkspaceIndexedEntry[] = [];
  const seen = new Set<string>();
  let files = 0;
  let directories = 0;
  let pathBytes = 0;
  const streamed = await runGitNulRecords(
    workspace,
    [
      "ls-files", "-z", "-t", "--stage", "--cached", "--others",
      "--exclude-standard",
    ],
    (record) => {
      const entry = parseGitFileEntry(record);
      if (!entry) return true;
      const key = `${entry.entryKind}:${entry.path}`;
      if (seen.has(key)) return true;
      if (
        (entry.entryKind === "file" && files >= limits.files) ||
        (entry.entryKind === "dir" && directories >= limits.directories)
      ) return false;
      const bytes = Buffer.byteLength(entry.path, "utf8");
      if (pathBytes + bytes > pathByteLimit) return false;
      seen.add(key);
      pathBytes += bytes;
      if (entry.entryKind === "file") files += 1;
      else directories += 1;
      entries.push(entry);
      return true;
    },
    {
      timeoutMs: WORKSPACE_FILE_GIT_TIMEOUT_MS,
      maxOutputBytes: rawOutputByteLimit,
      maxRecords: WORKSPACE_GIT_INDEX_RAW_RECORD_LIMIT,
      maxRecordBytes: WORKSPACE_GIT_INDEX_RAW_RECORD_BYTE_LIMIT,
    }
  );
  return {
    entries,
    fileTruncated: streamed.truncated,
    directoryTruncated: streamed.truncated,
  };
}

async function walkFiles(
  workspace: string,
  limits: WorkspaceIndexLimits,
  pathByteLimit: number
): Promise<WorkspaceListResult> {
  const files: WorkspaceIndexedEntry[] = [];
  const directories: WorkspaceIndexedEntry[] = [];
  const visitLimit = limits.files + limits.directories + WALK_VISIT_SLACK;
  let visited = 0;
  let fileTruncated = false;
  let directoryTruncated = false;
  let budgetTruncated = false;
  let retainedPathBytes = 0;
  const retain = (
    entries: WorkspaceIndexedEntry[],
    entry: WorkspaceIndexedEntry
  ) => {
    const bytes = Buffer.byteLength(entry.path, "utf8");
    if (retainedPathBytes + bytes > pathByteLimit) {
      budgetTruncated = true;
      return false;
    }
    retainedPathBytes += bytes;
    entries.push(entry);
    return true;
  };
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > WALK_DEPTH_LIMIT || budgetTruncated) return;
    const entries = await opendir(directory);
    for await (const entry of entries) {
      visited += 1;
      if (visited > visitLimit) {
        budgetTruncated = true;
        break;
      }
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      const candidate = relative(workspace, path).split(sep).join("/");
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
        if (!validWorkspaceRelativePath(candidate)) continue;
        if (directories.length < limits.directories) {
          if (!retain(directories, { path: candidate, entryKind: "dir" })) break;
        } else {
          directoryTruncated = true;
        }
        if (depth >= WALK_DEPTH_LIMIT) {
          fileTruncated = true;
          directoryTruncated = true;
        } else {
          await visit(path, depth + 1);
        }
      } else if (entry.isFile() && validWorkspaceRelativePath(candidate)) {
        if (files.length < limits.files) {
          if (!retain(files, { path: candidate, entryKind: "file" })) break;
        } else {
          fileTruncated = true;
        }
      }
      if (budgetTruncated) break;
    }
  };
  await visit(workspace, 0);
  return {
    entries: [...files, ...directories],
    fileTruncated: fileTruncated || budgetTruncated,
    directoryTruncated: directoryTruncated || budgetTruncated,
  };
}

export function defaultListWorkspaceFiles(
  workspace: string,
  git: boolean,
  limits: WorkspaceIndexLimits,
  budgets: WorkspaceEnumerationBudgets = {}
) {
  const bounded = (value: number | undefined, ceiling: number) => {
    if (value === undefined) return ceiling;
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError("Workspace 索引预算必须是正安全整数");
    }
    return Math.min(value, ceiling);
  };
  const pathBytes = bounded(
    budgets.pathBytes,
    WORKSPACE_INDEX_PATH_BYTE_LIMIT
  );
  const rawOutputBytes = bounded(
    budgets.gitRawOutputBytes,
    WORKSPACE_GIT_INDEX_RAW_OUTPUT_BYTE_LIMIT
  );
  return git
    ? gitFiles(workspace, limits, pathBytes, rawOutputBytes)
    : walkFiles(workspace, limits, pathBytes);
}

async function currentEntity(
  workspace: string,
  entry: WorkspaceIndexedEntry,
  walk: boolean
): Promise<WorkspaceEntryMetadata | null> {
  const segments = entry.path.split("/");
  if (walk && segments.length > WALK_DEPTH_LIMIT + 1) return null;
  let current = workspace;
  try {
    for (let index = 0; index < segments.length; index += 1) {
      current = resolve(current, segments[index]!);
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) return null;
      const last = index === segments.length - 1;
      if (!last) {
        if (!metadata.isDirectory()) return null;
        if (walk && EXCLUDED_DIRECTORIES.has(segments[index]!)) return null;
        continue;
      }
      const kind = metadata.isFile()
        ? "file"
        : metadata.isDirectory()
          ? "dir"
          : null;
      if (kind !== entry.entryKind) return null;
      if (walk && kind === "dir" && EXCLUDED_DIRECTORIES.has(segments[index]!)) {
        return null;
      }
      return {
        kind,
        dev: Number(metadata.dev),
        ino: Number(metadata.ino),
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
      };
    }
  } catch {
    return null;
  }
  return null;
}

/** fresh proof：Git 只认当前 cached/untracked+ignore 结果；非 Git 逐段复演 walker 规则。 */
export async function proveWorkspaceEntry(
  workspace: string,
  entry: WorkspaceIndexedEntry
): Promise<WorkspaceEntryMetadata | null> {
  if (!validWorkspaceRelativePath(entry.path)) return null;
  try {
    const output = await runGit(
      workspace,
      [
        "ls-files", "-z", "-t", "--stage", "--cached", "--others",
        "--exclude-standard", "--", `:(literal)${entry.path}`,
      ],
      { timeoutMs: WORKSPACE_FILE_GIT_TIMEOUT_MS }
    );
    const member = parseGitFileEntries(output).some(
      (candidate) =>
        candidate.path === entry.path && candidate.entryKind === entry.entryKind
    );
    return member ? currentEntity(workspace, entry, false) : null;
  } catch (cause) {
    if (!notGitRepository(cause)) throw cause;
    return currentEntity(workspace, entry, true);
  }
}
