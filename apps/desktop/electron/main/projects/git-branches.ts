/**
 * [INPUT]: Depends on git-runner's read-only/user-only warehouse mutation Execute the boundary with shared/projects-ipc's branch DTO
 * [OUTPUT]: Provides list of GitBranches/checkoutGitBranch/createGitBranch with GitBranchSnapshot
 * [POS]: The Git branch of the projects module is the definitive kernel; Read your own refs, don't fetch/stash/push, and don't build your own spawn
 */

import type {
  GitBranchRef,
  GitBranchSnapshot,
  GitBranchTarget,
} from "../../../shared/projects-ipc";
import { runGit, runProjectGitMutation, tryGit } from "./git-runner";

type LocalBranch = GitBranchRef & {
  kind: "local";
  upstream: string | null;
};

type RemoteBranch = GitBranchRef & {
  kind: "remote";
};

type BranchDetail = LocalBranch | RemoteBranch;

type BranchState = Omit<GitBranchSnapshot, "branches"> & {
  branches: BranchDetail[];
};

function countStatusEntries(output: string) {
  const records = output.split("\0");
  let count = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const kind = record[0];
    if (kind === "1" || kind === "u" || kind === "?") count += 1;
    if (kind === "2") {
      count += 1;
      index += 1;
    }
  }
  return count;
}

function parseBranches(output: string, head: string, detached: boolean) {
  const branches: BranchDetail[] = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const [ref, upstream = "", symbolic = ""] = line.split("\t");
    if (ref.startsWith("refs/heads/")) {
      const name = ref.slice("refs/heads/".length);
      branches.push({
        name,
        kind: "local",
        current: !detached && name === head,
        upstream: upstream || null,
      });
    }
    if (ref.startsWith("refs/remotes/") && !symbolic) {
      branches.push({
        name: ref.slice("refs/remotes/".length),
        kind: "remote",
        current: false,
      });
    }
  }
  return branches.sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1;
    if (left.kind !== right.kind) return left.kind === "local" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

async function readState(workspace: string): Promise<BranchState | null> {
  const inside = await tryGit(workspace, ["rev-parse", "--is-inside-work-tree"]);
  if (inside?.trim() !== "true") return null;
  const symbolic = await tryGit(workspace, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const detached = symbolic === null;
  const head = detached
    ? (await runGit(workspace, ["rev-parse", "--short", "HEAD"])).trim()
    : symbolic.trim();
  const [refs, status] = await Promise.all([
    runGit(workspace, [
      "for-each-ref",
      "--sort=refname",
      "--format=%(refname)%09%(upstream:short)%09%(symref)",
      "refs/heads",
      "refs/remotes",
    ]),
    runGit(workspace, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]),
  ]);
  return {
    head,
    detached,
    uncommittedFiles: countStatusEntries(status),
    branches: parseBranches(refs, head, detached),
  };
}

function publicSnapshot(state: BranchState): GitBranchSnapshot {
  return {
    head: state.head,
    detached: state.detached,
    uncommittedFiles: state.uncommittedFiles,
    branches: state.branches.map(({ name, kind, current }) => ({
      name,
      kind,
      current,
    })),
  };
}

async function requireState(workspace: string) {
  const state = await readState(workspace);
  if (!state) throw new Error("所选 Project 不是 Git 仓库");
  return state;
}

export async function listGitBranches(workspace: string) {
  const state = await readState(workspace);
  return state ? publicSnapshot(state) : null;
}

export async function checkoutGitBranch(
  workspace: string,
  target: GitBranchTarget
) {
  const state = await requireState(workspace);
  const branch = state.branches.find(
    (item) => item.kind === target.kind && item.name === target.name
  );
  if (!branch) throw new Error(`Branch 不存在：${target.name}`);
  if (branch.current) return publicSnapshot(state);
  if (branch.kind === "local") {
    await runProjectGitMutation(workspace, ["switch", "--", branch.name]);
  } else {
    const tracked = state.branches.find(
      (item): item is LocalBranch =>
        item.kind === "local" && item.upstream === branch.name
    );
    if (tracked) {
      await runProjectGitMutation(workspace, ["switch", "--", tracked.name]);
    } else {
      await runProjectGitMutation(workspace, [
        "switch",
        "--track",
        "--no-guess",
        branch.name,
      ]);
    }
  }
  return publicSnapshot(await requireState(workspace));
}

export async function createGitBranch(workspace: string, rawName: string) {
  await requireState(workspace);
  const name = rawName.trim();
  if (!name) throw new Error("Branch name 不能为空");
  const normalized = (await runGit(workspace, ["check-ref-format", "--branch", name])).trim();
  if (normalized !== name) throw new Error("Branch name 无效");
  await runProjectGitMutation(workspace, ["switch", "-c", name, "--"]);
  return publicSnapshot(await requireState(workspace));
}
