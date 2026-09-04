/**
 * [INPUT]: Depends on Node filesystem/path facts and the sole bounded Git runner with executable-config auditing and owned-mutation sandboxing
 * [OUTPUT]: Provides managed fork-worktree preflight, exact-SHA creation, identity validation, read-only deletion admission, clean-only removal, and scoped commit
 * [POS]: Project Git policy for Product-owned Chat worktrees; callers retain Project lifecycle and Chat Home saga ownership
 */

import { access, lstat } from "node:fs/promises";
import { join } from "node:path";
import { canonicalPath, overlaps } from "../../backends/sandbox/sbpl";
import {
  GitCommandError,
  assertOwnedGitMutationPlatform,
  isNotRepositoryFailure,
  resolveGitIdentity,
  runGit,
  runGitNulRecords,
  runOwnedGitMutationSequence,
  type GitRepositoryIdentity,
  type GitSandboxSpec,
} from "./git-runner";
import { auditExecutableGitConfig, listGitConfig } from "./git-config-audit";

const exists = async (path: string) => access(path).then(() => true, () => false);

export type ManagedWorktreeDirtyFacts = Readonly<{
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  ignored: boolean;
}>;

export type ManagedWorktreePreflight = Readonly<{
  platform: NodeJS.Platform;
  supported: boolean;
  identity: GitRepositoryIdentity;
  baseCommit: string;
  branch: string;
  detached: boolean;
  dirty: ManagedWorktreeDirtyFacts;
}>;

export const managedWorktreeBranch = (childChatId: string) => {
  const safe = childChatId.replace(/[^A-Za-z0-9]/gu, "").slice(0, 12);
  if (!safe) throw new Error("Managed worktree child id has no branch-safe identity");
  return `bottega/fork/${safe}`;
};

async function assertNoRepositoryOperation(commonDir: string) {
  const names = [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
    "rebase-apply",
    "rebase-merge",
  ];
  for (const name of names) {
    if (await exists(join(commonDir, name))) {
      throw new GitCommandError("GIT_OPERATION_IN_PROGRESS", `GIT_OPERATION_IN_PROGRESS: ${name}`, {
        argv: ["worktree", "add"],
        cwd: commonDir,
      });
    }
  }
}

async function dirtyFacts(workspace: string): Promise<ManagedWorktreeDirtyFacts> {
  const dirty = { staged: false, unstaged: false, untracked: false, ignored: false };
  const status = await runGit(workspace, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  for (const record of status.split("\0").filter(Boolean)) {
    const code = record.slice(0, 2);
    if (code === "??") dirty.untracked = true;
    else {
      if (code[0] !== " ") dirty.staged = true;
      if (code[1] !== " ") dirty.unstaged = true;
    }
  }
  await runGitNulRecords(
    workspace,
    ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
    () => {
      dirty.ignored = true;
      return false;
    },
    { maxOutputBytes: 64 * 1024, maxRecords: 1, maxRecordBytes: 16 * 1024 }
  );
  return dirty;
}

/* 逐条流式读 HEAD 树的 object mode，遇到第一个 gitlink 就停：整棵树的
   清单会随仓库规模撑破 4 MiB 运行预算，大仓库从此永远开不了 worktree。 */
async function assertNoGitlink(workspace: string) {
  let gitlink = false;
  const { truncated } = await runGitNulRecords(
    workspace,
    ["ls-tree", "-r", "-z", "--format=%(objectmode)", "HEAD"],
    (record) => {
      gitlink = record === "160000";
      return !gitlink;
    },
    { maxOutputBytes: 64 * 1024 * 1024, maxRecords: 10_000_000, maxRecordBytes: 64 }
  );
  if (gitlink) throw new Error("GIT_SUBMODULE_UNSUPPORTED");
  if (truncated) throw new Error("GIT_TREE_SCAN_TRUNCATED");
}

/* 每个拒绝理由都是稳定机器码：renderer 只翻译码，不解析 Git stderr。 */
async function assertRepositoryEligible(workspace: string) {
  const identity = await resolveGitIdentity(workspace).catch((cause) => {
    if (isNotRepositoryFailure(cause)) throw new Error("WORKTREE_NOT_GIT_REPOSITORY");
    throw cause;
  });
  if (identity.topLevel !== canonicalPath(workspace, "Managed worktree source")) {
    throw new Error("WORKTREE_NOT_GIT_ROOT");
  }
  const [bare, baseCommit, symbolic, blockers] = await Promise.all([
    runGit(workspace, ["rev-parse", "--is-bare-repository"]),
    runGit(workspace, ["rev-parse", "--verify", "HEAD^{commit}"]).catch((cause) => {
      if (cause instanceof GitCommandError && cause.code === "GIT_COMMAND_FAILED") {
        throw new Error("WORKTREE_NO_HEAD");
      }
      throw cause;
    }),
    runGit(workspace, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch((cause) => {
      if (
        cause instanceof GitCommandError &&
        cause.code === "GIT_COMMAND_FAILED" &&
        cause.detail.exitCode === 1
      ) return "";
      throw cause;
    }),
    listGitConfig(workspace).then(auditExecutableGitConfig),
  ]);
  if (bare.trim() === "true") throw new Error("GIT_BARE_REPOSITORY");
  await assertNoGitlink(workspace);
  if (blockers.length) {
    throw new GitCommandError(blockers[0]!.code, `${blockers[0]!.code}: ${blockers[0]!.message}`, {
      argv: ["config", "--list", "--show-origin"],
      cwd: workspace,
      stderr: `${blockers[0]!.key} @ ${blockers[0]!.origin}`,
    });
  }
  await assertNoRepositoryOperation(identity.commonDir);
  return {
    identity,
    baseCommit: baseCommit.trim(),
    branch: symbolic.trim(),
    detached: !symbolic.trim(),
  };
}

export async function preflightManagedWorktree(
  workspace: string
): Promise<ManagedWorktreePreflight> {
  const repository = await assertRepositoryEligible(workspace);
  return {
    platform: process.platform,
    supported: process.platform === "darwin",
    ...repository,
    dirty: await dirtyFacts(workspace),
  };
}

const sandboxFor = (
  source: GitRepositoryIdentity,
  worktreeDir: string
): GitSandboxSpec => ({
  commonDir: source.commonDir,
  writeRoots: [source.commonDir, worktreeDir],
  denyRoots: [source.topLevel],
  readRoots: [source.topLevel, worktreeDir],
});

async function branchExists(workspace: string, branch: string) {
  const refs = await runGit(workspace, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/heads",
  ]);
  return refs.split("\n").includes(`refs/heads/${branch}`);
}

export async function createManagedWorktree(input: Readonly<{
  sourceWorkspace: string;
  worktreeDir: string;
  baseCommit: string;
  branch: string;
  expectedIdentity: GitRepositoryIdentity;
}>) {
  assertOwnedGitMutationPlatform(process.platform, {
    argv: ["worktree", "add"],
    cwd: input.sourceWorkspace,
  });
  if (
    overlaps(
      canonicalPath(input.worktreeDir, "Managed worktree root"),
      input.expectedIdentity.topLevel
    )
  ) throw new Error("WORKTREE_PATH_CONFLICT");
  const command = [
    "worktree",
    "add",
    "-b",
    input.branch,
    input.worktreeDir,
    input.baseCommit,
  ];
  return runOwnedGitMutationSequence(
    input.sourceWorkspace,
    sandboxFor(input.expectedIdentity, input.worktreeDir),
    command,
    async (run, identity) => {
      if (
        identity.topLevel !== input.expectedIdentity.topLevel ||
        identity.commonDir !== input.expectedIdentity.commonDir
      ) throw new Error("GIT_IDENTITY_DRIFT");
      if (await exists(input.worktreeDir)) {
        return validateManagedWorktree({
          sourceIdentity: identity,
          worktreeDir: input.worktreeDir,
          branch: input.branch,
          baseCommit: input.baseCommit,
        });
      }
      if (await branchExists(input.sourceWorkspace, input.branch)) {
        throw new Error("WORKTREE_BRANCH_EXISTS");
      }
      await run(command);
      return validateManagedWorktree({
        sourceIdentity: identity,
        worktreeDir: input.worktreeDir,
        branch: input.branch,
        baseCommit: input.baseCommit,
      });
    }
  );
}

/* 固定路径之下再证形态：目录与 `.git` 指针都不能是 symlink，且 Git 自己
   也认它是 worktree 顶层。turn 准入与 Git mutation 共用这一条判据。 */
export async function assertManagedWorktreeShape(worktreeDir: string) {
  const [rootStat, pointerStat] = await Promise.all([
    lstat(worktreeDir),
    lstat(join(worktreeDir, ".git")),
  ]).catch(() => { throw new Error("WORKTREE_IDENTITY_MISMATCH"); });
  if (
    rootStat.isSymbolicLink() ||
    !rootStat.isDirectory() ||
    pointerStat.isSymbolicLink() ||
    !pointerStat.isFile()
  ) throw new Error("WORKTREE_IDENTITY_MISMATCH");
  const identity = await resolveGitIdentity(worktreeDir);
  if (identity.topLevel !== canonicalPath(worktreeDir, "Managed worktree root")) {
    throw new Error("WORKTREE_IDENTITY_MISMATCH");
  }
  return identity;
}

export async function validateManagedWorktree(input: Readonly<{
  sourceIdentity: GitRepositoryIdentity;
  worktreeDir: string;
  branch: string;
  baseCommit?: string;
}>) {
  const identity = await assertManagedWorktreeShape(input.worktreeDir);
  const [branch, commit] = await Promise.all([
    runGit(input.worktreeDir, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    runGit(input.worktreeDir, ["rev-parse", "--verify", "HEAD^{commit}"]),
  ]);
  if (
    identity.commonDir !== input.sourceIdentity.commonDir ||
    branch.trim() !== input.branch ||
    (input.baseCommit && commit.trim() !== input.baseCommit)
  ) throw new Error("WORKTREE_IDENTITY_MISMATCH");
  return { identity, branch: branch.trim(), commit: commit.trim() };
}

async function registeredWorktree(sourceWorkspace: string, worktreeDir: string) {
  const output = await runGit(sourceWorkspace, ["worktree", "list", "--porcelain", "-z"]);
  const expected = canonicalPath(worktreeDir, "Managed worktree registration");
  return output.split("\0").some((line) =>
    line.startsWith("worktree ") &&
    canonicalPath(line.slice("worktree ".length), "Registered worktree") === expected
  );
}

export async function removeManagedWorktree(input: Readonly<{
  sourceWorkspace: string;
  sourceIdentity: GitRepositoryIdentity;
  worktreeDir: string;
  branch: string;
}>): Promise<"absent" | "removed" | "recovery"> {
  const command = ["worktree", "remove", input.worktreeDir];
  return runOwnedGitMutationSequence(
    input.sourceWorkspace,
    sandboxFor(input.sourceIdentity, input.worktreeDir),
    command,
    async (run, identity) => {
      if (
        identity.topLevel !== input.sourceIdentity.topLevel ||
        identity.commonDir !== input.sourceIdentity.commonDir
      ) return "recovery";
      const [registered, present] = await Promise.all([
        registeredWorktree(input.sourceWorkspace, input.worktreeDir),
        exists(input.worktreeDir),
      ]);
      if (!registered && !present) return "absent";
      if (!registered || !present) return "recovery";
      await validateManagedWorktree({
        sourceIdentity: input.sourceIdentity,
        worktreeDir: input.worktreeDir,
        branch: input.branch,
      });
      if (Object.values(await dirtyFacts(input.worktreeDir)).some(Boolean)) {
        return "recovery";
      }
      await run(command);
      const [stillRegistered, stillPresent] = await Promise.all([
        registeredWorktree(input.sourceWorkspace, input.worktreeDir),
        exists(input.worktreeDir),
      ]);
      return stillRegistered || stillPresent ? "recovery" : "removed";
    }
  );
}

export async function inspectManagedWorktree(input: Readonly<{
  sourceWorkspace: string;
  sourceIdentity: GitRepositoryIdentity;
  worktreeDir: string;
  branch: string;
}>): Promise<"absent" | "clean" | "recovery"> {
  const [registered, present] = await Promise.all([
    registeredWorktree(input.sourceWorkspace, input.worktreeDir),
    exists(input.worktreeDir),
  ]);
  if (!registered && !present) return "absent";
  if (!registered || !present) return "recovery";
  try {
    await validateManagedWorktree(input);
    return Object.values(await dirtyFacts(input.worktreeDir)).some(Boolean)
      ? "recovery"
      : "clean";
  } catch {
    return "recovery";
  }
}

/* 用退出码而不是文件清单判断"有没有 staged 改动"：清单会随改动规模撑破
   输出预算，而 add 已经发生，一旦在这里失败，worktree 就既提交不了也删不掉。 */
async function hasStagedChanges(
  run: (args: readonly string[]) => Promise<string>
) {
  try {
    await run(["diff", "--cached", "--quiet"]);
    return false;
  } catch (cause) {
    if (
      cause instanceof GitCommandError &&
      cause.code === "GIT_COMMAND_FAILED" &&
      cause.detail.exitCode === 1
    ) return true;
    throw cause;
  }
}

export async function commitManagedWorktree(input: Readonly<{
  sourceIdentity: GitRepositoryIdentity;
  worktreeDir: string;
  branch: string;
  message: string;
}>) {
  const message = input.message.trim();
  if (!message || message.length > 200) throw new Error("INVALID_COMMIT_MESSAGE");
  const sandbox = sandboxFor(input.sourceIdentity, input.worktreeDir);
  const add = ["add", "-A", "--", "."];
  return runOwnedGitMutationSequence(
    input.worktreeDir,
    sandbox,
    add,
    async (run) => {
      await validateManagedWorktree(input);
      await run(add);
      if (!(await hasStagedChanges(run))) return { committed: false, commit: null };
      await run(["commit", "-m", message]);
      const commit = (await run(["rev-parse", "HEAD"])).trim();
      return { committed: true, commit };
    }
  );
}
