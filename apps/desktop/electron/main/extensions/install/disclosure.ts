/**
 * [INPUT]: Depends on Node fs/path, adapter registry and admission results
 * [OUTPUT]: Provides listPackageFiles, discloseExtensionPackage, capabilityLines and diffCapabilities
 * [POS]: The ability to disclose extensions/install; The same measurement is shared between the installation and the update, and diff is comparable
 */

import { readFile, stat } from "node:fs/promises";
import { opendir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { admitExtensionPackageWithAdapter, type ExtensionAdapterId } from "../admission";
import type { ExtensionPackageAdmission } from "../manifest-adapter";
import { digestCanonical, type ExtensionSourceProvenance } from "../registry-store";

const SCRIPT_EXTENSIONS = new Set([
  "sh", "bash", "zsh", "js", "mjs", "cjs", "ts", "py", "rb", "pl", "php",
]);

export type ExtensionCapabilityDisclosure = Readonly<{
  /** 包内可被执行的文件；用户必须在安装前看见它们 */
  executableScripts: readonly string[];
  skills: readonly Readonly<{
    componentId: string;
    name: string;
    allowedTools: readonly string[];
    contentDigest: `sha256:${string}`;
  }>[];
  mcpServers: readonly Readonly<{
    componentId: string;
    serverId: string;
    transport: "stdio" | "streamable-http" | "sse";
    endpoint?: string;
    command?: string;
    /** 只披露 header 名字：值可能是凭据，不进 UI 也不进日志 */
    staticHeaderNames: readonly string[];
  }>[];
  /** 含 stdio ⇒ 需要 install-owned `PLUGIN_DATA` 写根 */
  requiresPluginDataWriteRoot: boolean;
}>;

export type ExtensionPackageFile = Readonly<{ path: string; bytes: number }>;

/** 逐代能力必须用同一次遍历口径产出，否则 diff 会把「两把尺子」说成「扩权」。 */
export async function listPackageFiles(
  root: string,
  current = root
): Promise<ExtensionPackageFile[]> {
  const files: ExtensionPackageFile[] = [];
  const directory = await opendir(current);
  for await (const entry of directory) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listPackageFiles(root, path)));
      continue;
    }
    /* 入库时已拒过 symlink；这里再遇到只可能是被外部动过，不纳入披露。 */
    if (!entry.isFile()) continue;
    files.push({ path: relative(root, path), bytes: (await stat(path)).size });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function discloseExtensionPackage(input: {
  packageRoot: string;
  files: readonly ExtensionPackageFile[];
  admission: ExtensionPackageAdmission;
}): Promise<ExtensionCapabilityDisclosure> {
  const skills = [];
  const mcpServers: ExtensionCapabilityDisclosure["mcpServers"][number][] = [];
  for (const component of input.admission.components) {
    if (component.kind === "skill") {
      skills.push({
        componentId: component.componentId,
        name: component.name,
        allowedTools: await readAllowedTools(component.skillFile),
        contentDigest: await digestSkillDirectory(component.skillFile),
      });
      continue;
    }
    const config = component.config;
    mcpServers.push({
      componentId: component.componentId,
      serverId: component.serverId,
      transport: config.type,
      ...(config.type === "stdio"
        ? { command: config.command }
        : { endpoint: config.url }),
      staticHeaderNames:
        config.type === "stdio" ? [] : Object.keys(config.headers ?? {}).sort(),
    });
  }
  return {
    executableScripts: input.files
      .map((file) => file.path)
      .filter((path) => SCRIPT_EXTENSIONS.has(path.split(".").pop() ?? ""))
      .sort(),
    skills,
    mcpServers,
    requiresPluginDataWriteRoot: input.admission.containsStdio,
  };
}

/** 已落盘的旧代照样能被重新披露：内容寻址根还在，因为它仍被引用着。 */
export async function discloseInstalledGeneration(input: {
  packageRoot: string;
  adapterId: ExtensionAdapterId;
  source: ExtensionSourceProvenance;
}) {
  const resolved = await admitExtensionPackageWithAdapter(
    input.adapterId,
    input.packageRoot,
    input.source
  );
  const files = await listPackageFiles(input.packageRoot);
  return discloseExtensionPackage({
    packageRoot: input.packageRoot,
    files,
    admission: resolved.admission,
  });
}

/* canonical 能力行：一行就是一项用户批准过的能力。行集合是集合语义，
   顺序无关；新增即扩权，减少只是缩权。 */
export function capabilityLines(
  disclosure: ExtensionCapabilityDisclosure
): string[] {
  return [
    ...disclosure.executableScripts.map((path) => `script:${path}`),
    ...disclosure.skills.map(
      (skill) =>
        `skill:${skill.name} digest=${skill.contentDigest} allowed-tools=${skill.allowedTools.join(",") || "-"}`
    ),
    ...disclosure.mcpServers.map(
      (server) =>
        `mcp:${server.serverId} ${server.transport} ${
          server.endpoint ?? server.command ?? "-"
        } headers=${server.staticHeaderNames.join(",") || "-"}`
    ),
    ...(disclosure.requiresPluginDataWriteRoot ? ["plugin-data-write-root"] : []),
  ].sort();
}

export function diffCapabilities(
  previous: ExtensionCapabilityDisclosure,
  next: ExtensionCapabilityDisclosure
) {
  const before = new Set(capabilityLines(previous));
  const after = new Set(capabilityLines(next));
  const added = [...after].filter((line) => !before.has(line));
  return {
    added,
    removed: [...before].filter((line) => !after.has(line)),
    /* 扩权必须重新授权：新代 seal 后一律回到未启用，不静默继承旧授权。 */
    requiresReauthorization: added.length > 0,
  };
}

/* `allowed-tools` 是 Skill 自带的能力扩张面，规范正文没把它交给 plugin.json，
   所以只能读 SKILL.md frontmatter；读不到就是空，不猜。 */
async function readAllowedTools(skillFile: string) {
  const content = await readFile(skillFile, "utf8").catch(() => "");
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? "";
  const raw = /^allowed-tools:\s*(.+)$/m.exec(block)?.[1]?.trim();
  if (!raw) return [];
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

async function digestSkillDirectory(skillFile: string) {
  const root = dirname(skillFile);
  const files = await listPackageFiles(root);
  const payload = [];
  for (const file of files) {
    payload.push([
      file.path,
      digestCanonical((await readFile(join(root, file.path))).toString("base64")),
    ]);
  }
  return digestCanonical(payload);
}
