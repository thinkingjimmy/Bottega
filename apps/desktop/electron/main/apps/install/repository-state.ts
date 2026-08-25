/**
 * [INPUT]: Depends on Node crypto/fs/path, apps/support isContained and AppRecord for shared/apps-ipc
 * [OUTPUT]: Provides porcelain v1 -z file-level analysis, working-tree fingerprinting and RepositoryState
 * [POS]: The apps/install warehouse changes the ledger and the untracked directory is expanded to the real file content
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AppRecord } from "../../../../shared/apps-ipc";
import { isContained } from "../support";

export async function fingerprintWorkingTree(
  record: AppRecord,
  statusOutput: string
) {
  const changes = parsePorcelainV1Z(statusOutput).filter(
    ({ path }) => !path.startsWith(".naming-product/")
  );
  const paths = changes.map(({ path }) => path);
  const hash = createHash("sha256");
  for (const change of changes) {
    hash.update(`${change.status}\0${change.path}\0`);
    const path = resolve(record.dir, change.path);
    if (!isContained(record.dir, path)) continue;
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        hash.update(`symlink:${await readlink(path)}`);
      } else if (info.isFile()) {
        for await (const chunk of createReadStream(path)) hash.update(chunk);
      } else {
        hash.update(`node:${info.mode}:${info.size}`);
      }
    } catch {
      hash.update("missing");
    }
  }
  return { paths, fingerprint: hash.digest("hex") };
}

export function parsePorcelainV1Z(output: string) {
  const fields = output.split("\0");
  const changes: Array<{ status: string; path: string }> = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field || field.length < 4 || field[2] !== " ") continue;
    const status = field.slice(0, 2);
    const path = field.slice(3);
    if (path) changes.push({ status, path });
    if (/[RC]/.test(status)) index += 1;
  }
  return changes;
}

export class RepositoryState {
  constructor(private readonly userData: string) {}

  async read(appId: string) {
    try {
      return (await readFile(this.path(appId), "utf8")).trim();
    } catch {
      return "";
    }
  }

  async write(appId: string, fingerprint: string) {
    await mkdir(join(this.userData, "apps-state"), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(this.path(appId), `${fingerprint}\n`, { mode: 0o600 });
  }

  remove(appId: string) {
    return rm(this.path(appId), { force: true });
  }

  private path(appId: string) {
    return join(this.userData, "apps-state", `${appId}.fingerprint`);
  }
}
