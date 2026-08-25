/**
 * [INPUT]: Depends on Node fs/crypto, AppRecord and extended delivery directories
 * [OUTPUT]: Provides extended inspect/verify, semantic tree summaries, durable marketplace, build and declined conversions
 * [POS]: The back end of apps/install is the neutral expansion kernel; Plan Binding Delivery Load, Specific CLI Apply to Maintenance Adapter
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import type { AppManifest, AppRecord } from "../../../../shared/apps-ipc";

export type ExtensionPlan = {
  pluginName: string | null;
  details: string[];
  files: Array<{ path: string; sha256: string }>;
  treeSha256: string;
};

export type ExtensionDecision = "none" | "declined" | "approved";

export class ExtensionInfrastructureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExtensionInfrastructureError";
  }
}

const sha256 = (content: Buffer | string) =>
  createHash("sha256").update(content).digest("hex");

const isDeliveryMetadata = (path: string) =>
  path === ".git" || path.startsWith(".git/") || path === ".app-manifest.json";

async function deliveryTreeSha256(appDir: string) {
  const hash = createHash("sha256");
  async function collect(path: string): Promise<void> {
    const relativePath = relative(appDir, path) || ".";
    if (isDeliveryMetadata(relativePath)) return;
    const info = await lstat(path);
    const type = info.isDirectory()
      ? "directory"
      : info.isSymbolicLink()
        ? "symlink"
        : info.isFile()
          ? "file"
          : "other";
    const semanticSize = type === "file" ? info.size : 0;
    hash.update(`${relativePath}\0${type}\0${info.mode}\0${semanticSize}\0`);
    if (type === "symlink") {
      hash.update(await readlink(path));
    } else if (type === "file") {
      for await (const chunk of createReadStream(path)) hash.update(chunk);
    } else if (type === "directory") {
      for (const name of (await readdir(path)).sort()) await collect(join(path, name));
    }
    hash.update("\0");
  }
  await collect(appDir);
  return hash.digest("hex");
}

export async function inspectExtension(appDir: string): Promise<ExtensionPlan | null> {
  const files: ExtensionPlan["files"] = [];
  async function collect(path: string): Promise<void> {
    const info = await lstat(path).catch(() => null);
    if (!info) return;
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await collect(join(path, name));
      return;
    }
    const content = info.isSymbolicLink()
      ? `symlink:${await readlink(path)}`
      : await readFile(path);
    files.push({ path: relative(appDir, path), sha256: sha256(content) });
  }
  for (const path of [
    ".agent-plugin",
    ".agent",
    ".mcp.json",
    "skills",
    ".agents/skills",
  ]) {
    await collect(join(appDir, path));
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  if (files.length === 0) return null;
  const pluginFile = files.find((file) => file.path === ".agent-plugin/plugin.json");
  let pluginName: string | null = null;
  if (pluginFile) {
    const plugin = JSON.parse(await readFile(join(appDir, pluginFile.path), "utf8")) as {
      name?: unknown;
    };
    if (typeof plugin.name !== "string" || !plugin.name.trim()) {
      throw new Error(".agent-plugin/plugin.json 缺少有效 name");
    }
    pluginName = plugin.name;
  }
  return {
    pluginName,
    files,
    treeSha256: await deliveryTreeSha256(appDir),
    details: files.map((file) => `${file.path}: ${file.sha256}`),
  };
}

export async function verifyExtensionPlan(appDir: string, plan: ExtensionPlan) {
  const current = await inspectExtension(appDir);
  if (
    !current ||
    current.treeSha256 !== plan.treeSha256 ||
    JSON.stringify(current.files) !== JSON.stringify(plan.files)
  ) {
    throw new Error("扩展文件在确认后发生变化，已拒绝安装");
  }
}

export function declineExtension(manifest: AppManifest): AppManifest {
  if (manifest.kind !== "server") return manifest;
  return {
    ...manifest,
    serveAgentPrompt: null,
    serveTrigger: null,
    agentRequirements: null,
  };
}

export const pluginMarketplaceRoot = (userData: string, appId: string) =>
  join(userData, "plugin-marketplaces", appId);

// ============================================================================
// 持久 marketplace：Codex 要求 local plugin path 位于 marketplace root 内部且
// 以 ./ 开头（绝对路径与越界相对路径均拒绝），故以 root 内 symlink 穿透到交付目录。
// 目录归产品所有、每次 apply 原子重建，`plugin list` 的常驻校验永远可通过。
// ============================================================================
export async function buildPluginMarketplace(input: {
  userData: string;
  record: Pick<AppRecord, "id" | "displayName">;
  appDir: string;
  pluginName: string;
}) {
  const { userData, record, appDir, pluginName } = input;
  const root = pluginMarketplaceRoot(userData, record.id);
  const manifest = `${JSON.stringify({
    name: `app-${record.id}`,
    interface: { displayName: record.displayName },
    plugins: [{
      name: pluginName,
      source: { source: "local", path: "./app" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    }],
  }, null, 2)}\n`;
  try {
    await rm(root, { recursive: true, force: true });
    await mkdir(join(root, ".agents", "plugins"), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(join(root, ".agents", "plugins", "marketplace.json"), manifest, {
      mode: 0o600,
    });
    await symlink(appDir, join(root, "app"));
  } catch (cause) {
    throw new ExtensionInfrastructureError("无法构建插件 marketplace 目录", {
      cause,
    });
  }
  return root;
}
