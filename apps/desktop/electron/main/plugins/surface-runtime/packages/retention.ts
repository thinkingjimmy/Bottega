/**
 * [INPUT]: Depends on exact immutable packet references and guarded account-owned archive directories.
 * [OUTPUT]: Provides account-scoped archive paths, guarded directory creation, bounded regular-file collection and complete account custody removal with parent fsync.
 * [POS]: Filesystem-only custody leaf; callers hold their original package/account journal writer and retention roots.
 */
import { lstat, mkdir, rm, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import { syncDirectory } from "../../../persistence/durable-json";
const stat = async (path: string) =>
  lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
async function directory(path: string) {
  const info = await stat(path);
  if (info && (!info.isDirectory() || info.isSymbolicLink()))
    throw new Error("WIDGET_PACKAGE_CUSTODY_CHANGED");
  return info;
}
export function widgetArchiveDirectory(userData: string, accountId: string) {
  if (!accountId || accountId.length > 256)
    throw new Error("WIDGET_PACKAGE_SCOPE_INVALID");
  return join(
    userData,
    "widget-package-archives",
    hashCanonical({ accountId }),
  );
}
export async function ensureWidgetArchiveDirectory(
  userData: string,
  accountId: string,
) {
  const account = widgetArchiveDirectory(userData, accountId),
    root = dirname(account);
  if (!(await directory(userData)))
    throw new Error("WIDGET_PACKAGE_CUSTODY_CHANGED");
  for (const path of [root, account]) {
    await directory(path);
    await mkdir(path, { recursive: true, mode: 0o700 });
    await directory(path);
  }
  return account;
}
export async function removeWidgetAccountArchives(
  userData: string,
  accountId: string,
) {
  const account = widgetArchiveDirectory(userData, accountId),
    root = dirname(account);
  if (
    !(await directory(userData)) ||
    !(await directory(root)) ||
    !(await directory(account))
  )
    return;
  await rm(account, { recursive: true });
  await syncDirectory(root);
}
export async function removeWidgetArchives(
  root: string,
  references: readonly string[],
) {
  if (
    !(await directory(dirname(dirname(root)))) ||
    !(await directory(dirname(root))) ||
    !(await directory(root))
  )
    return;
  const paths: string[] = [];
  for (const reference of references) {
    if (!/^sha256:[a-f0-9]{64}$/.test(reference))
      throw new Error("WIDGET_PACKAGE_REFERENCE_INVALID");
    const path = join(root, reference.slice(7) + ".json"),
      info = await stat(path);
    if (!info) continue;
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
      throw new Error("WIDGET_PACKAGE_CUSTODY_CHANGED");
    paths.push(path);
  }
  for (const path of paths) await unlink(path);
  if (paths.length) await syncDirectory(root);
}
