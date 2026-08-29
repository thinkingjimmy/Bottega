/**
 * [INPUT]: Depends on live App surface descriptions, the shared effective-workspace resolver, DesignEnabled, CanvasRegistry, and Node no-follow file handles
 * [OUTPUT]: Provides DesignWorkspaceAccess with surface-bound workspace resolution, pre-resolved read-mostly registered lists/reads, inode-bound strict-HTML reads, secure import, scans, and atomic restore writes
 * [POS]: Design's filesystem authority adapter; renderer paths never select a workspace and registry membership never replaces a live lease proof
 */

import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { EffectiveWorkspaceResolver } from "../workspace-resolver";
import {
  CanvasRegistry,
  canonicalDesignPath,
  type CanvasProvenance,
} from "./storage/canvas-registry";
import type { DesignEnabled } from "./enabled";
import { lintDesignHtml } from "./anti-slop";

export const DESIGN_CANVAS_BYTE_LIMIT = 8 * 1024 * 1024;

export type DesignSurfaceBinding = Readonly<{ surfaceLeaseId: string }>;
export type DesignSurface = Readonly<{
  surfaceLeaseId: string;
  appId: string;
  conversationId: string;
  conversationIncarnationId: string;
  workspaceAuthorityIdentity: string;
}>;
export type ResolvedDesignWorkspace = Readonly<{
  surface: DesignSurface;
  workspace: string;
  authorityIdentity: string;
  stableWorkspaceOwnerId: string;
}>;
export type DesignWorkspaceIdentity = Pick<
  ResolvedDesignWorkspace,
  "workspace" | "authorityIdentity" | "stableWorkspaceOwnerId"
>;
export type DesignFileSnapshot = Readonly<{
  path: string;
  digest: string;
  content: Buffer;
}>;
export type DesignCandidateSnapshot = Readonly<{
  path: string;
  signature: string;
}>;

type AccessPorts = Readonly<{
  describeSurface(surfaceLeaseId: string): Promise<DesignSurface> | DesignSurface;
  resolveEffectiveWorkspace: EffectiveWorkspaceResolver;
  enabled: DesignEnabled;
}>;

export class DesignWorkspaceAccess {
  constructor(
    private readonly registry: CanvasRegistry,
    private readonly ports: AccessPorts
  ) {}

  async resolveBinding(binding: DesignSurfaceBinding) {
    if (
      !binding ||
      typeof binding !== "object" ||
      Object.keys(binding).length !== 1 ||
      typeof binding.surfaceLeaseId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(binding.surfaceLeaseId)
    ) {
      throw statusError(400, "Design surface binding 无效");
    }
    const surface = await this.ports.describeSurface(binding.surfaceLeaseId);
    if (
      surface.surfaceLeaseId !== binding.surfaceLeaseId ||
      !this.ports.enabled.isAppEnabled(surface.appId)
    ) {
      throw statusError(403, "Design App 当前不可用");
    }
    const effective = this.ports.resolveEffectiveWorkspace({
      kind: "conversation",
      conversationId: surface.conversationId,
    });
    if (effective.kind !== "ready") {
      throw statusError(409, effective.message);
    }
    const authorityIdentity = effective.authorityIdentity;
    if (surface.workspaceAuthorityIdentity !== authorityIdentity) {
      throw statusError(410, "Design surface workspace authority 已漂移");
    }
    // stableWorkspaceOwnerId 在 ready 变体上非可选：绝不 ?? 回退到可变的
    // authority identity（那会把持久 owner 键悄悄替换成 fence 身份，构成 contract-1 泄漏）。
    return {
      surface,
      workspace: effective.workspace,
      authorityIdentity,
      stableWorkspaceOwnerId: effective.stableWorkspaceOwnerId,
    } satisfies ResolvedDesignWorkspace;
  }

  async listResolved(resolved: ResolvedDesignWorkspace) {
    const registered = this.registry.list(resolved.stableWorkspaceOwnerId);
    const files: string[] = [];
    const canvases: Array<Readonly<{
      file: string;
      digest: string;
      advisories: ReturnType<typeof lintDesignHtml>;
    }>> = [];
    for (const entry of registered.entries) {
      try {
        const content = await this.readResolved(resolved, entry.canonicalRelativePath);
        files.push(entry.canonicalRelativePath);
        const currentDigest = digest(content);
        canvases.push({
          file: entry.canonicalRelativePath,
          digest: currentDigest,
          advisories: lintDesignHtml(content),
        });
        if (currentDigest !== entry.currentDigest) {
          await this.registry.register({
            stableWorkspaceOwnerId: resolved.stableWorkspaceOwnerId,
            relativePath: entry.canonicalRelativePath,
            digest: currentDigest,
            provenance: entry.provenance,
          });
        }
      } catch {
        // 单个已登记 canvas 当前不可读（缺失/非法内容/超限/符号链接）不得让整批
        // list 失败——否则一个坏文件会永久禁用该 workspace 的 discovery。跳过即可；
        // 仅 readRegisteredResolved 这种“显式请求单个路径”的调用才允许上抛错误。
        continue;
      }
    }
    return { files, canvases, revision: this.registry.revision(), drafting: false };
  }

  async readRegisteredResolved(
    resolved: DesignWorkspaceIdentity,
    relativePath: string
  ) {
    const path = canonicalDesignPath(relativePath);
    const entry = this.registry.get(resolved.stableWorkspaceOwnerId, path);
    if (!entry) {
      throw statusError(404, "Canvas 未登记");
    }
    const content = await this.readResolved(resolved, path);
    const currentDigest = digest(content);
    if (currentDigest !== entry.currentDigest) {
      await this.registry.register({
        stableWorkspaceOwnerId: resolved.stableWorkspaceOwnerId,
        relativePath: path,
        digest: currentDigest,
        provenance: entry.provenance,
      });
    }
    return content;
  }

  async snapshotDesignFiles(resolved: DesignWorkspaceIdentity) {
    // create:false —— 快照/arm 阶段绝不预建 design/，否则 Design 开启后用户
    // 每个仓库都会残留一个空的 design/ 且无清理路径。目录不存在即“没有 canvas”。
    const designRoot = await this.designRoot(resolved.workspace, false).catch(
      (cause) => {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw cause;
      }
    );
    if (!designRoot) return [];
    const files: DesignFileSnapshot[] = [];
    for (const entry of await readdir(designRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}\.html$/i.test(entry.name)) {
        continue;
      }
      const path = `design/${entry.name}`;
      // 单个坏文件（非法 UTF-8/HTML、超限、读取期被替换/截断、符号链接）不得
      // 中断整批扫描——否则一个坏文件会永久拖垮该 workspace 的 arm/discovery。
      try {
        const content = await this.readResolved(resolved, path);
        files.push({ path, content, digest: digest(content) });
      } catch {
        continue;
      }
    }
    return files;
  }

  async snapshotCandidateStates(resolved: DesignWorkspaceIdentity) {
    const designRoot = await this.designRoot(resolved.workspace, false).catch(
      (cause) => {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw cause;
      }
    );
    if (!designRoot) return [];
    const candidates: DesignCandidateSnapshot[] = [];
    for (const entry of await readdir(designRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}\.html$/i.test(entry.name)) continue;
      const metadata = await lstat(join(designRoot, entry.name)).catch(() => null);
      if (!metadata?.isFile() || metadata.isSymbolicLink()) continue;
      candidates.push({
        path: `design/${entry.name}`,
        signature: `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}`,
      });
    }
    return candidates.sort((left, right) => left.path.localeCompare(right.path));
  }

  async scanAndRegister(
    resolved: DesignWorkspaceIdentity,
    provenance: CanvasProvenance,
    baseline: Map<string, string>
  ) {
    const changed: string[] = [];
    const files = await this.snapshotDesignFiles(resolved);
    for (const file of files) {
      if (baseline.get(file.path) === file.digest) continue;
      await this.registry.register({
        stableWorkspaceOwnerId: resolved.stableWorkspaceOwnerId,
        relativePath: file.path,
        digest: file.digest,
        provenance,
      });
      baseline.set(file.path, file.digest);
      changed.push(file.path);
    }
    return changed;
  }

  async listImportCandidates(resolved: ResolvedDesignWorkspace) {
    const registered = new Set(
      this.registry.list(resolved.stableWorkspaceOwnerId).entries.map(
        (entry) => entry.canonicalRelativePath
      )
    );
    return (await this.snapshotDesignFiles(resolved))
      .map((file) => file.path)
      .filter((file) => !registered.has(file))
      .sort();
  }

  async importResolved(
    resolved: ResolvedDesignWorkspace,
    relativePath: string,
    provenance: CanvasProvenance = {}
  ) {
    const path = canonicalDesignPath(relativePath);
    const content = await this.readResolved(resolved, path);
    const entry = await this.registry.register({
      stableWorkspaceOwnerId: resolved.stableWorkspaceOwnerId,
      relativePath: path,
      digest: digest(content),
      provenance,
    });
    return { resolved, entry, content };
  }

  async writeRegistered(
    resolved: DesignWorkspaceIdentity,
    relativePath: string,
    content: Buffer
  ) {
    const path = canonicalDesignPath(relativePath);
    if (!this.registry.get(resolved.stableWorkspaceOwnerId, path)) {
      throw statusError(404, "Canvas 未登记");
    }
    if (content.byteLength > DESIGN_CANVAS_BYTE_LIMIT) {
      throw statusError(413, "Design canvas 超过 8 MiB");
    }
    assertHtmlDocument(content);
    const designRoot = await this.designRoot(resolved.workspace, true);
    const target = join(designRoot, path.slice("design/".length));
    const temporary = join(designRoot, `.restore-${randomUUID()}.tmp`);
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      const current = await lstat(target).catch((cause) => {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw cause;
      });
      if (current?.isSymbolicLink() || (current && !current.isFile())) {
        throw statusError(403, "Canvas restore target 不是普通文件");
      }
      await rename(temporary, target);
      await this.readResolved(resolved, path);
    } catch (cause) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw cause;
    }
  }

  async readResolved(resolved: DesignWorkspaceIdentity, relativePath: string) {
    const path = canonicalDesignPath(relativePath);
    const designRoot = await this.designRoot(resolved.workspace, false);
    const requested = join(designRoot, path.slice("design/".length));
    const metadata = await lstat(requested);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw statusError(403, "Canvas 不是普通文件");
    }
    const canonical = await realpath(requested);
    if (canonical !== requested || !contained(designRoot, canonical)) {
      throw statusError(403, "Canvas 路径越界或含符号链接");
    }
    const handle = await open(
      canonical,
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    try {
      const before = await handle.stat();
      assertReadable(before);
      assertOpenedIdentity(metadata, before);
      const content = await boundedRead(handle, before.size);
      const after = await handle.stat();
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs
      ) {
        throw statusError(409, "Canvas 在读取期间发生变化");
      }
      assertHtmlDocument(content);
      return content;
    } finally {
      await handle.close();
    }
  }

  private async designRoot(workspace: string, create: boolean) {
    const root = await realpath(workspace);
    const path = join(root, "design");
    if (create) await mkdir(path, { recursive: true, mode: 0o700 });
    const canonical = await realpath(path);
    if (canonical !== path || !contained(root, canonical)) {
      throw statusError(403, "Design directory 越界或含符号链接");
    }
    return canonical;
  }
}

function contained(root: string, target: string) {
  const value = relative(root, target);
  return value === "" ||
    (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

function assertReadable(metadata: Stats) {
  if (!metadata.isFile()) throw statusError(403, "Canvas 不是普通文件");
  if (metadata.size > DESIGN_CANVAS_BYTE_LIMIT) {
    throw statusError(413, "Design canvas 超过 8 MiB");
  }
}

export function assertOpenedIdentity(leaf: Stats, opened: Stats) {
  if (leaf.dev !== opened.dev || leaf.ino !== opened.ino) {
    throw statusError(409, "Canvas 在校验与打开之间被替换");
  }
}

async function boundedRead(
  handle: Awaited<ReturnType<typeof open>>,
  size: number
) {
  const output = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(
      output,
      offset,
      Math.min(64 * 1024, size - offset),
      offset
    );
    if (!bytesRead) throw statusError(409, "Canvas 在读取期间被截断");
    offset += bytesRead;
  }
  return output;
}

export function digest(content: Buffer) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function assertHtmlDocument(content: Buffer) {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw statusError(415, "Design canvas 必须是有效 UTF-8 文本");
  }
  if (hasDisallowedControl(source)) {
    throw statusError(415, "Design canvas 含二进制控制字符");
  }
  const document = source.replace(/^\uFEFF?\s*/, "");
  if (
    !/^(?:<!doctype\s+html\b[^>]*>\s*)?<html\b[^>]*>/i.test(document) ||
    !/<\/html>\s*$/i.test(document)
  ) {
    throw statusError(415, "Design canvas 必须是完整 HTML 文档");
  }
}

function hasDisallowedControl(source: string) {
  for (const character of source) {
    const code = character.charCodeAt(0);
    if (code === 0x7f || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)) {
      return true;
    }
  }
  return false;
}

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
