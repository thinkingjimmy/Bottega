/**
 * [INPUT]: Depends on Workspace-resolver, workspace-file-index/read, shared Workspace IPC/fuzzy, pure functions with Node realpath/lstat
 * [OUTPUT]: Provides search/scan and a hard-top, 8 MiB single index and 32 MiB global path caching budget, 256 chat recent LRU, generation-token, fail, fresh-proof opaque readRef
 * [POS]: The ability-free Workspace candidate directory of Electron main and the dual-limit LRU owner; Members prove to have commissioned index, content reading boundaries, read authority
 */

import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { BrowserWindow } from "electron";
import {
  WORKSPACE_DIRECTORY_INDEX_LIMIT,
  WORKSPACE_FILES_CHANNEL,
  WORKSPACE_FILE_INDEX_LIMIT,
  WORKSPACE_FILE_QUERY_BYTE_LIMIT,
  WORKSPACE_FILE_RESULT_LIMIT,
  workspaceEntryKind,
  type WorkspaceFileEntry,
  type WorkspaceFileReadInput,
  type WorkspaceFileResignInput,
  type WorkspaceFilesSearchInput,
  type WorkspaceFilesSearchResult,
} from "../../shared/workspace-files-ipc";
import { fuzzyScore } from "../../shared/workspace-fuzzy";
import type { SubmissionContentV1 } from "../../shared/submission";
import { rendererIpc } from "./ipc-registrar";
import { GitCommandError } from "./projects/git/git-runner";
import {
  buildWorkspaceIndex,
  defaultIsGitRepository,
  defaultListWorkspaceFiles as defaultListFiles,
  proveWorkspaceEntry,
  validWorkspaceRelativePath as validRelativePath,
  WORKSPACE_INDEX_PATH_BYTE_LIMIT,
  type WorkspaceEntryMetadata,
  type WorkspaceIndexedEntry as IndexedEntry,
  type WorkspaceIndexLimits as IndexLimits,
  type WorkspaceListResult,
} from "./workspace-file-index";
import {
  WorkspaceFileReadAuthority,
  WorkspaceFileReadError,
} from "./workspace-file-read";
import {
  assertWorkspaceScope,
  type EffectiveWorkspace,
  type EffectiveWorkspaceResolver,
} from "./workspace-resolver";

const INDEX_TTL_MS = 15_000;
const WORKSPACE_CACHE_LIMIT = 32;
const WORKSPACE_CACHE_PATH_BYTE_LIMIT = 32 * 1024 * 1024;
export const WORKSPACE_SEARCH_CONCURRENCY_LIMIT = 4;
export const WORKSPACE_SEARCH_STAT_CONCURRENCY_LIMIT = 8;
export const WORKSPACE_RESIGN_CONCURRENCY_LIMIT = 4;
export const WORKSPACE_SCAN_CONCURRENCY_LIMIT = 4;
export const WORKSPACE_RECENT_BUCKET_LIMIT = 256;
const RECENT_LIMIT = 32;
const RECENT_MESSAGE_LIMIT = 256;

type EntryKind = "file" | "dir";
type FileKind = EntryKind | "symlink" | "missing";
type FileIndex = {
  entries: IndexedEntry[];
  pathBytes: number;
  indexed: number;
  indexTruncated: boolean;
  fileIndexTruncated: boolean;
  directoryIndexTruncated: boolean;
};
type IndexToken = { valid: boolean };
type CacheEntry = FileIndex & { expiresAt: number; token: IndexToken };
type PendingIndex = { promise: Promise<FileIndex>; token: IndexToken };
type LoadedIndex = { index: FileIndex; token: IndexToken; servedFromCache: boolean };
type RecentBucket = {
  identity: string;
  incarnationId: string;
  paths: string[];
  messageIds: Set<string>;
};

const DEFAULT_INDEX_LIMITS: IndexLimits = {
  files: WORKSPACE_FILE_INDEX_LIMIT,
  directories: WORKSPACE_DIRECTORY_INDEX_LIMIT,
};

class WorkspaceFileCatalogError extends Error {}

function stableIndexError(cause: unknown) {
  if (cause instanceof WorkspaceFileCatalogError) return cause.message;
  if (cause instanceof GitCommandError) {
    if (cause.code === "GIT_TIMEOUT") return "Git 文件索引超时";
    if (cause.code === "GIT_OUTPUT_OVERFLOW") return "Git 文件索引输出超出预算";
    return "Git 文件索引失败";
  }
  return "Workspace 文件索引失败";
}

type WorkspaceFileCatalogDependencies = {
  now?: () => number;
  isGitRepository?: (workspace: string) => Promise<boolean>;
  listFiles?: (
    workspace: string,
    git: boolean,
    limits: Readonly<IndexLimits>
  ) => Promise<Array<string | IndexedEntry> | WorkspaceListResult>;
  statFile?: (path: string) => Promise<FileKind>;
  getChatIncarnation?: (chatId: string) => string | undefined;
  /** 仅用于小预算真实 walker 回归；生产组合根不得注入。 */
  indexLimits?: IndexLimits;
  /** 只缩小资源上限的测试 seam；生产组合根不得注入。 */
  indexPathByteLimit?: number;
  cachePathByteLimit?: number;
  /** 只暂停、不替换 fresh proof 的并发回归 seam。 */
  testBeforeFreshProof?: () => Promise<void> | void;
};

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>
) {
  const results: R[] = [];
  for (let offset = 0; offset < items.length; offset += limit) {
    const settled = await Promise.allSettled(
      items.slice(offset, offset + limit).map(mapper)
    );
    const rejected = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (rejected) throw rejected.reason;
    results.push(...settled.map((result) => (result as PromiseFulfilledResult<R>).value));
  }
  return results;
}

function exactObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}

function validChatId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    assertWorkspaceScope({ kind: "conversation", conversationId: value });
    return true;
  } catch {
    return false;
  }
}

export function assertWorkspaceFilesSearchInput(
  value: unknown
): WorkspaceFilesSearchInput {
  if (!exactObject(value, ["scope", "query"], ["chatId"])) {
    throw new Error("Workspace 文件搜索参数无效");
  }
  const input = value as { scope: unknown; query: unknown; chatId?: unknown };
  if (
    typeof input.query !== "string" ||
    Buffer.byteLength(input.query, "utf8") > WORKSPACE_FILE_QUERY_BYTE_LIMIT ||
    (input.chatId !== undefined && !validChatId(input.chatId))
  ) {
    throw new Error("Workspace 文件搜索词无效");
  }
  return {
    scope: assertWorkspaceScope(input.scope),
    query: input.query,
    ...(input.chatId === undefined ? {} : { chatId: input.chatId }),
  };
}

export function assertWorkspaceFileResignInput(
  value: unknown
): WorkspaceFileResignInput {
  if (!exactObject(value, ["scope", "path", "entryKind"])) {
    throw new Error("Workspace readRef 重签参数无效");
  }
  const input = value as WorkspaceFileResignInput;
  if (
    !validRelativePath(input.path) ||
    workspaceEntryKind(input.entryKind) !== input.entryKind
  ) {
    throw new Error("Workspace readRef 重签路径无效");
  }
  return {
    scope: assertWorkspaceScope(input.scope),
    path: input.path,
    entryKind: input.entryKind,
  };
}

function assertReadInput(value: unknown): WorkspaceFileReadInput {
  if (!exactObject(value, ["scope", "readRef"])) {
    throw new Error("Workspace 文件读取参数无效");
  }
  const input = value as WorkspaceFileReadInput;
  if (typeof input.readRef !== "string" || input.readRef.length > 256) {
    throw new Error("Workspace readRef 无效");
  }
  return { scope: assertWorkspaceScope(input.scope), readRef: input.readRef };
}

async function defaultStatFile(path: string): Promise<FileKind> {
  try {
    const metadata = await lstat(path);
    return metadata.isSymbolicLink()
      ? "symlink"
      : metadata.isFile()
        ? "file"
        : metadata.isDirectory()
          ? "dir"
          : "missing";
  } catch {
    return "missing";
  }
}

const normalized = (value: string) => value.normalize("NFKC").toLowerCase();
const depth = (path: string) => path.split("/").length;
const lexical = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

function ranked(path: string, query: string) {
  if (!query) return { rank: 0, score: 0 };
  const name = normalized(basename(path));
  if (name.startsWith(query)) return { rank: 0, score: 0 };
  if (name.includes(query)) return { rank: 1, score: 0 };
  if (normalized(path).includes(query)) return { rank: 2, score: 0 };
  const score = fuzzyScore(path, query);
  return score === null ? null : { rank: 3, score };
}

function candidates(
  entries: readonly IndexedEntry[],
  rawQuery: string,
  recent: ReadonlyMap<string, number>
) {
  const query = normalized(rawQuery);
  return entries
    .map((entry) => ({ ...entry, match: ranked(entry.path, query) }))
    .filter(
      (
        entry
      ): entry is typeof entry & { match: { rank: number; score: number } } =>
        entry.match !== null
    )
    .sort(
      (left, right) =>
        left.match.rank - right.match.rank ||
        (recent.get(left.path) ?? Number.POSITIVE_INFINITY) -
          (recent.get(right.path) ?? Number.POSITIVE_INFINITY) ||
        right.match.score - left.match.score ||
        depth(left.path) - depth(right.path) ||
        lexical(left.path, right.path)
    )
    .map(({ path, entryKind }) => ({ path, entryKind }));
}

function sameMetadata(
  left: WorkspaceEntryMetadata,
  right: WorkspaceEntryMetadata
) {
  return left.kind === right.kind &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs;
}

export class WorkspaceFileCatalog {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, PendingIndex>();
  private readonly reads: WorkspaceFileReadAuthority;
  private readonly recent = new Map<string, RecentBucket>();
  private activeSearches = 0;
  private activeScans = 0;
  private activeResigns = 0;
  private cachePathBytes = 0;

  constructor(
    private readonly resolveEffectiveWorkspace: EffectiveWorkspaceResolver,
    private readonly dependencies: WorkspaceFileCatalogDependencies = {}
  ) {
    this.reads = new WorkspaceFileReadAuthority(
      resolveEffectiveWorkspace,
      () => this.now()
    );
  }

  register(window: BrowserWindow, rendererUrl: string) {
    rendererIpc(window, rendererUrl, "拒绝非主窗口的 Workspace 文件请求")
      .handle(WORKSPACE_FILES_CHANNEL.search, (value) =>
        this.search(assertWorkspaceFilesSearchInput(value))
      )
      .handle(WORKSPACE_FILES_CHANNEL.resign, (value) =>
        this.resign(assertWorkspaceFileResignInput(value))
      )
      .handle(WORKSPACE_FILES_CHANNEL.read, (value) =>
        this.read(assertReadInput(value))
      );
  }

  async search(
    value: WorkspaceFilesSearchInput
  ): Promise<WorkspaceFilesSearchResult> {
    if (this.activeSearches >= WORKSPACE_SEARCH_CONCURRENCY_LIMIT) {
      return {
        kind: "unavailable",
        reason: "index-failed",
        detail: "WORKSPACE_FILE_SEARCH_BUSY",
      };
    }
    this.activeSearches += 1;
    try {
      return await this.searchStable(assertWorkspaceFilesSearchInput(value), 0);
    } catch (cause) {
      return {
        kind: "unavailable",
        reason: "index-failed",
        detail: stableIndexError(cause),
      };
    } finally {
      this.activeSearches -= 1;
    }
  }

  recordRecentFiles(input: {
    chatId: string;
    incarnationId: string;
    messageId: string;
    content: SubmissionContentV1;
  }) {
    if (input.content.origin !== "composer") return;
    const paths = input.content.content.richValue.flatMap((node) => {
      const value = node as { type?: unknown; path?: unknown };
      return value.type === "workspace-file" &&
        typeof value.path === "string" &&
        validRelativePath(value.path)
        ? [value.path]
        : [];
    });
    if (!paths.length) return;
    const effective = this.resolveEffectiveWorkspace({
      kind: "conversation",
      conversationId: input.chatId,
    });
    if (effective.kind !== "ready") return;
    const bucket = this.recent.get(input.chatId);
    const next = bucket &&
      bucket.identity === effective.identity &&
      bucket.incarnationId === input.incarnationId
      ? bucket
      : {
          identity: effective.identity,
          incarnationId: input.incarnationId,
          paths: [],
          messageIds: new Set<string>(),
        };
    if (next.messageIds.has(input.messageId)) {
      this.touchRecentBucket(input.chatId, next);
      return;
    }
    next.messageIds.add(input.messageId);
    while (next.messageIds.size > RECENT_MESSAGE_LIMIT) {
      next.messageIds.delete(next.messageIds.values().next().value!);
    }
    for (const path of paths) {
      next.paths = [
        path,
        ...next.paths.filter((candidate) => candidate !== path),
      ].slice(0, RECENT_LIMIT);
    }
    this.touchRecentBucket(input.chatId, next);
  }

  invalidateAll() {
    const workspaces = new Set([
      ...this.cache.keys(),
      ...this.pending.keys(),
    ]);
    for (const workspace of workspaces) this.invalidateWorkspace(workspace);
  }

  clear() {
    this.invalidateAll();
    this.reads.clear();
    this.recent.clear();
  }

  private invalidateWorkspace(workspace: string) {
    const pending = this.pending.get(workspace);
    if (pending) pending.token.valid = false;
    this.deleteCached(workspace);
    this.pending.delete(workspace);
  }

  private async searchStable(
    input: WorkspaceFilesSearchInput,
    attempt: number
  ): Promise<WorkspaceFilesSearchResult> {
    const effective = this.resolveEffectiveWorkspace(input.scope);
    if (effective.kind === "unavailable") {
      return { kind: "unavailable", reason: effective.reason };
    }
    if (effective.owner.kind === "default") {
      return { kind: "unavailable", reason: "no-workspace" };
    }
    const workspace = await realpath(effective.workspace);
    const loaded = await this.loadIndex(workspace);
    if (
      !loaded.token.valid ||
      !(await this.sameWorkspace(input.scope, effective, workspace))
    ) {
      this.invalidateWorkspace(workspace);
      if (attempt < 2) return this.searchStable(input, attempt + 1);
      throw new WorkspaceFileCatalogError(
        "Workspace 在文件扫描期间发生变化"
      );
    }
    const recent = await this.recentOrdinals(input, effective, workspace);
    const top = candidates(loaded.index.entries, input.query, recent).slice(
      0,
      WORKSPACE_FILE_RESULT_LIMIT
    );
    const entries = (
      await mapLimit(top, WORKSPACE_SEARCH_STAT_CONCURRENCY_LIMIT, async (entry) => {
        const kind = await this.statEntry(resolve(workspace, entry.path));
        if (kind !== entry.entryKind) return null;
        return {
          path: entry.path,
          name: basename(entry.path),
          dir: dirname(entry.path) === "." ? "" : dirname(entry.path),
          entryKind: entry.entryKind,
        } satisfies WorkspaceFileEntry;
      })
    ).filter((entry) => entry !== null);
    if (
      !loaded.token.valid ||
      !(await this.sameWorkspace(input.scope, effective, workspace))
    ) {
      this.invalidateWorkspace(workspace);
      if (attempt < 2) return this.searchStable(input, attempt + 1);
      throw new WorkspaceFileCatalogError(
        "Workspace 在文件候选核验期间发生变化"
      );
    }
    return {
      kind: "ready",
      entries,
      indexed: loaded.index.indexed,
      indexTruncated: loaded.index.indexTruncated,
      fileIndexTruncated: loaded.index.fileIndexTruncated,
      directoryIndexTruncated: loaded.index.directoryIndexTruncated,
      servedFromCache: loaded.servedFromCache,
    };
  }

  private async recentOrdinals(
    input: WorkspaceFilesSearchInput,
    effective: Extract<EffectiveWorkspace, { kind: "ready" }>,
    workspace: string
  ) {
    const chatId = input.scope.kind === "conversation"
      ? input.scope.conversationId
      : input.chatId;
    if (!chatId) return new Map<string, number>();
    const bucket = this.recent.get(chatId);
    if (!bucket) {
      return new Map<string, number>();
    }
    const incarnation = this.dependencies.getChatIncarnation?.(chatId);
    if (incarnation !== undefined && incarnation !== bucket.incarnationId) {
      this.recent.delete(chatId);
      return new Map<string, number>();
    }
    const chat = input.scope.kind === "conversation"
      ? effective
      : this.resolveEffectiveWorkspace({
          kind: "conversation",
          conversationId: chatId,
        });
    if (chat.kind !== "ready") {
      this.recent.delete(chatId);
      return new Map<string, number>();
    }
    if (chat.identity !== bucket.identity) {
      this.recent.delete(chatId);
      return new Map<string, number>();
    }
    this.touchRecentBucket(chatId, bucket);
    if (
      chat.identity !== effective.identity ||
      (await realpath(chat.workspace)) !== workspace
    ) {
      return new Map<string, number>();
    }
    return new Map(bucket.paths.map((path, ordinal) => [path, ordinal]));
  }

  private touchRecentBucket(chatId: string, bucket: RecentBucket) {
    this.recent.delete(chatId);
    this.recent.set(chatId, bucket);
    while (this.recent.size > WORKSPACE_RECENT_BUCKET_LIMIT) {
      const oldest = this.recent.keys().next().value;
      if (oldest === undefined) break;
      this.recent.delete(oldest);
    }
  }

  private async sameWorkspace(
    scope: WorkspaceFilesSearchInput["scope"],
    before: Extract<EffectiveWorkspace, { kind: "ready" }>,
    workspace: string
  ) {
    const current = this.resolveEffectiveWorkspace(scope);
    return current.kind === "ready" &&
      current.identity === before.identity &&
      (await realpath(current.workspace)) === workspace;
  }

  private async loadIndex(workspace: string): Promise<LoadedIndex> {
    const cached = this.cache.get(workspace);
    if (cached && cached.expiresAt > this.now()) {
      this.cache.delete(workspace);
      this.cache.set(workspace, cached);
      return { index: cached, token: cached.token, servedFromCache: true };
    }
    if (cached) {
      this.deleteCached(workspace);
    }
    let pending = this.pending.get(workspace);
    if (!pending) {
      if (this.activeScans >= WORKSPACE_SCAN_CONCURRENCY_LIMIT) {
        throw new WorkspaceFileCatalogError(
          "Workspace 文件索引繁忙，请稍后重试"
        );
      }
      const token: IndexToken = { valid: true };
      this.activeScans += 1;
      const promise = this.scan(workspace)
        .then((index) => {
          if (token.valid) this.storeCache(workspace, index, token);
          return index;
        })
        .finally(() => {
          this.activeScans -= 1;
        });
      pending = { promise, token };
    }
    this.pending.set(workspace, pending);
    try {
      return {
        index: await pending.promise,
        token: pending.token,
        servedFromCache: false,
      };
    } finally {
      if (this.pending.get(workspace) === pending) {
        this.pending.delete(workspace);
      }
    }
  }

  private async scan(workspace: string): Promise<FileIndex> {
    const limits = this.dependencies.indexLimits ?? DEFAULT_INDEX_LIMITS;
    const pathByteLimit =
      this.dependencies.indexPathByteLimit ?? WORKSPACE_INDEX_PATH_BYTE_LIMIT;
    const git = await (
      this.dependencies.isGitRepository ?? defaultIsGitRepository
    )(workspace);
    const listed = this.dependencies.listFiles
      ? await this.dependencies.listFiles(workspace, git, limits)
      : await defaultListFiles(workspace, git, limits, {
          pathBytes: pathByteLimit,
        });
    const listedResult = Array.isArray(listed) ? null : listed;
    const rawEntries = Array.isArray(listed) ? listed : listed.entries;
    const built = buildWorkspaceIndex(
      rawEntries,
      limits,
      {
        fileTruncated: listedResult?.fileTruncated ?? false,
        directoryTruncated: listedResult?.directoryTruncated ?? false,
      },
      pathByteLimit
    );
    return {
      entries: built.entries,
      pathBytes: built.pathBytes,
      indexed: built.entries.length,
      indexTruncated: built.fileTruncated || built.directoryTruncated,
      fileIndexTruncated: built.fileTruncated,
      directoryIndexTruncated: built.directoryTruncated,
    };
  }

  async resign(input: WorkspaceFileResignInput) {
    if (this.activeResigns >= WORKSPACE_RESIGN_CONCURRENCY_LIMIT) {
      throw new WorkspaceFileCatalogError("WORKSPACE_FILE_RESIGN_BUSY");
    }
    this.activeResigns += 1;
    try {
      return await this.resignStable(assertWorkspaceFileResignInput(input));
    } catch (cause) {
      if (
        cause instanceof WorkspaceFileCatalogError ||
        cause instanceof WorkspaceFileReadError
      ) throw cause;
      throw new WorkspaceFileCatalogError("Workspace readRef 重签失败");
    } finally {
      this.activeResigns -= 1;
    }
  }

  private async resignStable(input: WorkspaceFileResignInput) {
    if (input.entryKind !== "file") {
      throw new WorkspaceFileCatalogError("目录不提供 readRef");
    }
    const effective = this.resolveEffectiveWorkspace(input.scope);
    if (effective.kind !== "ready" || effective.owner.kind === "default") {
      throw new WorkspaceFileCatalogError("Workspace 不可用，无法重签 readRef");
    }
    const workspace = await realpath(effective.workspace);
    const loaded = await this.loadIndex(workspace);
    if (
      !loaded.token.valid ||
      !(await this.sameWorkspace(input.scope, effective, workspace))
    ) {
      this.invalidateWorkspace(workspace);
      throw new WorkspaceFileCatalogError(
        "Workspace 在 readRef 重签期间发生变化"
      );
    }
    const entry = loaded.index.entries.find(
      (candidate) =>
        candidate.path === input.path &&
        candidate.entryKind === input.entryKind
    );
    if (!entry) {
      throw new WorkspaceFileCatalogError("路径不在当前 Workspace 索引中");
    }
    await this.dependencies.testBeforeFreshProof?.();
    const before = await proveWorkspaceEntry(workspace, entry);
    if (!before) {
      throw new WorkspaceFileCatalogError("路径不再是当前 Workspace 成员");
    }
    const readRef = await this.issueReadRef(effective, workspace, entry, before);
    const after = await proveWorkspaceEntry(workspace, entry);
    if (
      !after ||
      !sameMetadata(before, after) ||
      !loaded.token.valid ||
      !(await this.sameWorkspace(input.scope, effective, workspace))
    ) {
      this.invalidateWorkspace(workspace);
      throw new WorkspaceFileCatalogError(
        "Workspace 在 readRef 重签期间发生变化"
      );
    }
    return { readRef };
  }

  async read(input: WorkspaceFileReadInput) {
    return this.reads.read(assertReadInput(input));
  }

  private async issueReadRef(
    effective: Extract<EffectiveWorkspace, { kind: "ready" }>,
    workspace: string,
    entry: IndexedEntry,
    metadata: WorkspaceEntryMetadata
  ) {
    return this.reads.issue({ effective, workspace, entry, metadata });
  }

  private statEntry(path: string) {
    return (
      this.dependencies.statFile ?? defaultStatFile
    )(path);
  }

  private storeCache(workspace: string, index: FileIndex, token: IndexToken) {
    this.deleteCached(workspace);
    this.cache.set(workspace, {
      ...index,
      token,
      expiresAt: this.now() + INDEX_TTL_MS,
    });
    this.cachePathBytes += index.pathBytes;
    const byteLimit =
      this.dependencies.cachePathByteLimit ?? WORKSPACE_CACHE_PATH_BYTE_LIMIT;
    while (
      this.cache.size > WORKSPACE_CACHE_LIMIT ||
      this.cachePathBytes > byteLimit
    ) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.invalidateWorkspace(oldest);
    }
  }

  private deleteCached(workspace: string) {
    const cached = this.cache.get(workspace);
    if (!cached) return;
    cached.token.valid = false;
    this.cache.delete(workspace);
    this.cachePathBytes -= cached.pathBytes;
  }

  private now() {
    return this.dependencies.now?.() ?? Date.now();
  }
}
