/**
 * [INPUT]: Depends on Node fs/path
 * [OUTPUT]: Provides directory availability, Project name cleaning, workspace/root, dual containment, a contract with a compensated directory, creating a core
 * [POS]: Project filesystem security boundaries of the projects modules, defined by Project's lack of data, directory chooser, standalone Project write and convert saga
 */

import { statSync } from "node:fs";
import { mkdir, realpath, rmdir } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

export function isUsableDirectory(dir: string) {
  if (!dir) return false;
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export function sanitizeProjectDirName(name: string) {
  const sanitized = name
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 60)
    .trim();
  return sanitized || "新项目";
}

function isWithin(candidate: string, parent: string) {
  const relation = relative(parent, candidate);
  return (
    relation === "" ||
    (!isAbsolute(relation) &&
      relation !== ".." &&
      !relation.startsWith(`..${sep}`))
  );
}

/** 契约 A：standalone workspace 与全部 managed root 必须双向不相交。 */
export function assertWorkspaceDisjoint(
  candidateCanonical: string,
  managedDirs: Iterable<string>
) {
  for (const managed of managedDirs) {
    if (
      isWithin(candidateCanonical, managed) ||
      isWithin(managed, candidateCanonical)
    ) {
      throw new Error(
        `Project workspace 与受管目录重叠：${candidateCanonical} ↔ ${managed}`
      );
    }
  }
}

/** 契约 B：Project 根可包含既有 Project，但不可等于或位于受管目录内。 */
export function assertRootOutsideManagedWorkspace(
  rootCanonical: string,
  managedDirs: Iterable<string>
) {
  for (const managed of managedDirs) {
    if (isWithin(rootCanonical, managed)) {
      throw new Error(
        `Project 存放位置位于受管目录内：${rootCanonical} ↔ ${managed}`
      );
    }
  }
}

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

async function cleanupCreated(
  candidate: string | undefined,
  root: string,
  createdRoot: boolean
) {
  const failures: string[] = [];
  if (candidate) {
    await rmdir(candidate).catch((cause) => {
      failures.push(`目录 ${candidate}：${errorText(cause)}`);
    });
  }
  if (createdRoot) {
    await rmdir(root).catch((cause) => {
      failures.push(`根目录 ${root}：${errorText(cause)}`);
    });
  }
  return failures;
}

/**
 * 原子占位一个新的 Project 文件夹。失败只用非递归 rmdir 回收本次创建物，
 * 因而用户文件永远不会被递归删除。
 */
export async function createProjectDirectory(
  root: string,
  name: string,
  takenDirs: Iterable<string>,
  managedDirs: Iterable<string>
) {
  let createdRoot = false;
  let candidate: string | undefined;
  const taken = new Set(takenDirs);
  const managed = [...managedDirs];
  try {
    createdRoot = Boolean(await mkdir(root, { recursive: true }));
    const rootCanonical = await realpath(root);
    assertRootOutsideManagedWorkspace(rootCanonical, managed);
    const base = sanitizeProjectDirName(name);
    for (let suffix = 1; suffix <= 9; suffix += 1) {
      candidate = join(rootCanonical, suffix === 1 ? base : `${base}-${suffix}`);
      if (taken.has(candidate)) {
        candidate = undefined;
        continue;
      }
      try {
        await mkdir(candidate);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
          candidate = undefined;
          continue;
        }
        throw cause;
      }
      const canonical = await realpath(candidate);
      if (taken.has(canonical)) {
        await rmdir(candidate);
        candidate = undefined;
        continue;
      }
      assertWorkspaceDisjoint(canonical, managed);
      return canonical;
    }
    throw new Error("Project 文件夹名称冲突，后缀 -2 至 -9 均已占用");
  } catch (cause) {
    if (
      cause instanceof Error &&
      cause.message.includes("清理未完成")
    ) {
      throw cause;
    }
    const residue = await cleanupCreated(candidate, root, createdRoot);
    const suffixText = residue.length
      ? `（清理未完成：${residue.join("；")}）`
      : "";
    throw new Error(`${errorText(cause)}${suffixText}`, { cause });
  }
}
