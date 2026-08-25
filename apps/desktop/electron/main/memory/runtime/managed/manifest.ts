/**
 * [INPUT]: Depends on Node fs/path/crypto and zod
 * [OUTPUT]: Provides hosted root layout, v3 manifest, last-known-good/three-phase durable version change + dataEpoch + managed/manual configuration status, restore dataRoot marker, runtime journal, secure root and plug-in unloading
 * [POS]: The main/memory/runtime/managed status layer is permanentlyOutbox does not have any wipe WAL, rebuildJob only keeps operationId references
 */

import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { durableReplaceFile } from "../../../persistence/durable-json";

const MARKER_FILE = ".ai-chat-owner";

const managedFileSchema = z
  .object({ mode: z.literal("managed"), hash: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const manualFileSchema = z.object({ mode: z.literal("manual") }).strict();
const versionChangeSchema = z
  .object({
    targetVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    phase: z.enum(["intent", "installing", "candidate-installed"]),
  })
  .strict();

const manifestSchema = z
  .object({
    /* Policy/Delivery v3 只认 dataEpoch；旧 manifest 不迁移、不解释。 */
    version: z.literal(3),
    providerId: z.string().min(1).max(64),
    instanceId: z.string().regex(/^[a-f0-9]{32}$/),
    dataEpoch: z.string().regex(/^[a-f0-9]{32}$/),
    ownershipToken: z.string().regex(/^[a-f0-9]{64}$/),
    installRoot: z.string().min(1).max(2048),
    dataRoot: z.string().min(1).max(2048),
    baseUrl: z.string().min(1).max(512),
    installedVersion: z.string().min(1).max(64),
    versionChange: versionChangeSchema.optional(),
    versionSource: z.enum(["locked", "selected"]).default("locked"),
    versionHistory: z
      .array(z.string().regex(/^\d+\.\d+\.\d+$/))
      .max(5)
      .default([]),
    installedAt: z.number().int().nonnegative(),
    files: z.record(z.string().min(1).max(255), z.union([managedFileSchema, manualFileSchema])),
  })
  .strict();

type ParsedManagedManifest = z.infer<typeof manifestSchema>;
export type ManagedManifest = Omit<
  ParsedManagedManifest,
  "versionSource" | "versionHistory"
> & {
  versionSource?: ParsedManagedManifest["versionSource"];
  versionHistory?: ParsedManagedManifest["versionHistory"];
};

const markerSchema = z
  .object({
    instanceId: z.string().regex(/^[a-f0-9]{32}$/),
    dataEpoch: z.string().regex(/^[a-f0-9]{32}$/),
    ownershipToken: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

/* ============================================================
 * 托管布局：installRoot 与 dataRoot 是两个根，永不重叠。
 * installRoot 装的是可重下载的字节，永不 purge；dataRoot 装的是
 * 用户数据，是唯一可 reset 的根——把它们混在一起，一次清库就会
 * 顺手删掉 venv，下次重建先花二十分钟重装。
 * ============================================================ */
export class ManagedRoots {
  readonly root: string;
  readonly installRoot: string;
  readonly dataRoot: string;
  readonly quarantineRoot: string;
  readonly manifestPath: string;
  readonly journalPath: string;

  constructor(userData: string, readonly providerId: string) {
    this.root = join(userData, "memory-runtimes", providerId);
    this.installRoot = join(this.root, "install");
    this.dataRoot = join(this.root, "data");
    this.quarantineRoot = join(this.root, "quarantine");
    this.manifestPath = join(this.root, "manifest.json");
    this.journalPath = join(this.root, "journal.jsonl");
  }

  venvBinary(executable: string) {
    return join(this.installRoot, "venv", "bin", executable);
  }

  async ensure() {
    await mkdir(this.installRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.dataRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.quarantineRoot, { recursive: true, mode: 0o700 });
  }

  async readManifest(): Promise<ManagedManifest | null> {
    try {
      return manifestSchema.parse(
        JSON.parse(await readFile(this.manifestPath, "utf8"))
      );
    } catch {
      return null;
    }
  }

  async writeManifest(manifest: ManagedManifest) {
    const parsed = manifestSchema.parse(manifest);
    await durableReplaceFile(
      this.manifestPath,
      `${JSON.stringify(parsed, null, 2)}\n`
    );
  }

  /* marker 是 dataRoot 自己的身份证：manifest 说「这是我的目录」，
     marker 回答「我确实属于你」。两边对不上就是外部替换，fail-closed。 */
  async writeMarker(manifest: ManagedManifest) {
    await mkdir(this.dataRoot, { recursive: true, mode: 0o700 });
    await writeFile(
      join(this.dataRoot, MARKER_FILE),
      `${JSON.stringify(
        {
          instanceId: manifest.instanceId,
          dataEpoch: manifest.dataEpoch,
          ownershipToken: manifest.ownershipToken,
        },
        null,
        2
      )}\n`,
      { mode: 0o600 }
    );
  }

  async readMarker() {
    try {
      return markerSchema.parse(
        JSON.parse(await readFile(join(this.dataRoot, MARKER_FILE), "utf8"))
      );
    } catch {
      return null;
    }
  }

  async ownershipValid(manifest: ManagedManifest | null) {
    if (!manifest) return null;
    try {
      const marker = await this.readMarker();
      if (!marker) return false;
      return (
        marker.instanceId === manifest.instanceId &&
        marker.dataEpoch === manifest.dataEpoch &&
        marker.ownershipToken === manifest.ownershipToken
      );
    } catch {
      return false;
    }
  }

  appendJournal(entry: Record<string, unknown>) {
    return appendFile(
      this.journalPath,
      `${JSON.stringify({ ...entry, at: Date.now() })}\n`,
      { mode: 0o600 }
    );
  }

  async readJournal(): Promise<Record<string, unknown>[]> {
    try {
      return (await readFile(this.journalPath, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    } catch {
      return [];
    }
  }
}

export function newInstanceIdentity() {
  return {
    instanceId: randomUUID().replaceAll("-", ""),
    dataEpoch: randomUUID().replaceAll("-", ""),
    ownershipToken: createHash("sha256")
      .update(`${randomUUID()}:${randomUUID()}`)
      .digest("hex"),
  };
}

export function rotateDataEpoch(manifest: ManagedManifest): ManagedManifest {
  return { ...manifest, dataEpoch: randomUUID().replaceAll("-", "") };
}

export function providerDataInstanceId(input: {
  providerId: string;
  instanceId: string;
  dataEpoch: string;
}) {
  return `${input.providerId}:${input.instanceId}:${input.dataEpoch}`;
}

const inside = (parent: string, child: string) =>
  child === parent || child.startsWith(`${parent}${sep}`);

/* ============================================================
 * 清根的全部安全性压在这一个断言上：能被 rename 掉的目录必须
 * 同时满足「在托管父目录下」「不是 home / 不是 installRoot」
 * 「realpath 不越界（symlink 逃逸）」。任何一条不成立就宁可挂起，
 * 也不执行一次不可撤销的删除。
 * ============================================================ */
export async function assertWipeSafe(roots: ManagedRoots) {
  const canonicalDataRoot = await realpath(roots.dataRoot);
  const canonicalRoot = await realpath(roots.root);
  const home = resolve(homedir());
  if (!inside(canonicalRoot, canonicalDataRoot)) {
    throw new Error("拒绝清理：数据根不在托管父目录内");
  }
  if (canonicalDataRoot === canonicalRoot) {
    throw new Error("拒绝清理：数据根与托管根重合");
  }
  if (canonicalDataRoot === home || inside(canonicalDataRoot, home)) {
    throw new Error("拒绝清理：数据根覆盖了用户主目录");
  }
  /* inside(parent, child)：这里问的是「安装目录是不是落在数据根里」，
     参数顺序写反的守卫不叫守卫，叫一句永远为假的安慰。 */
  if (inside(canonicalDataRoot, await realpath(roots.installRoot))) {
    throw new Error("拒绝清理：数据根包含安装目录");
  }
  return canonicalDataRoot;
}

/** 授权先落 journal，再原子 rename——rename 后崩溃仍可凭 journal 判「已安全隔离」。 */
export async function wipeDataRoot(
  roots: ManagedRoots,
  manifest: ManagedManifest
) {
  const canonicalDataRoot = await assertWipeSafe(roots);
  const operationId = `wipe_${randomUUID().replaceAll("-", "")}`;
  await roots.appendJournal({
    kind: "wipe-authorized",
    operationId,
    canonicalDataRoot,
    instanceId: manifest.instanceId,
    tokenHash: createHash("sha256")
      .update(manifest.ownershipToken)
      .digest("hex"),
  });
  const quarantine = join(roots.quarantineRoot, operationId);
  await mkdir(roots.quarantineRoot, { recursive: true, mode: 0o700 });
  await rename(canonicalDataRoot, quarantine);
  await roots.appendJournal({ kind: "wipe-quarantined", operationId });
  await mkdir(roots.dataRoot, { recursive: true, mode: 0o700 });
  await roots.writeMarker(manifest);
  /* 后台删除：隔离已经让新数据根干净，慢删不该阻塞回灌。 */
  void rm(quarantine, { recursive: true, force: true })
    .then(() => roots.appendJournal({ kind: "wipe-removed", operationId }))
    .catch(() => {});
  return operationId;
}

/* ============================================================
 * 卸载删的是整个托管根（venv、数据、manifest、journal、secrets 一体），
 * 没有 quarantine 可退——journal 自己也在被删的目录里，写「删除授权」
 * 是仪式。安全性同样压在断言上：realpath 后的目录必须仍叫
 * memory-runtimes/<providerId> 且不覆盖 home；symlink 把根指到别处，
 * canonical 名字就对不上，宁可拒绝也不删一个来历不明的目录。
 * 中途崩溃留半个根无妨：卸载幂等，重装会 ensure() 覆盖。
 * ============================================================ */
export async function removeManagedRoot(roots: ManagedRoots) {
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(roots.root);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
    throw cause;
  }
  const home = resolve(homedir());
  if (canonicalRoot === home || inside(canonicalRoot, home)) {
    throw new Error("拒绝卸载：运行时根覆盖了用户主目录");
  }
  if (
    basename(canonicalRoot) !== roots.providerId ||
    basename(dirname(canonicalRoot)) !== "memory-runtimes"
  ) {
    throw new Error("拒绝卸载：运行时根不在托管父目录内");
  }
  await rm(canonicalRoot, { recursive: true, force: true });
}
