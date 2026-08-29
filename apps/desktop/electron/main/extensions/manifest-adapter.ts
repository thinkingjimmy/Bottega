/**
 * [INPUT]: Depends on Node fs/path/http and Agent Plugins 1.0.0 Fixed schema id
 * [OUTPUT]: Provides Agent Plugins admission, strict Skill Detection and standardization component diagnosis
 * [POS]: The specification of extensions is the priority admission adapter; Parser only finds that the validator decides the facts of the library
 */

import { validateHeaderName, validateHeaderValue } from "node:http";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { SKILL_FRONTMATTER_PATTERN } from "../skills-management/skill-frontmatter";

export const AGENT_PLUGIN_SCHEMA_1_0_0 =
  "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const AGENT_PLUGIN_MCP_SCHEMA_1_0_0 =
  "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
export const AGENT_PLUGIN_ADAPTER_ID = "agent-plugins-1.0.0";

const MANIFEST_FIELDS = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);
const NAME_PATTERN = /^(?=.{1,64}$)[a-z0-9](?!.*(?:--|\.\.))[a-z0-9.-]*[a-z0-9]$|^[a-z0-9]$/;
const SERVER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BARE_COMMAND_PATTERN = /^[^/\\\s]+$/;

type JsonObject = Record<string, unknown>;

export type ExtensionAdmissionDiagnostic = Readonly<{
  severity: "report" | "error";
  scope: "package" | "skills" | "mcp" | "component";
  code?: "unsupported-version";
  path: string;
  message: string;
}>;

export type AdmittedSkill = Readonly<{
  kind: "skill";
  componentId: string;
  name: string;
  description: string;
  requires?: string;
  skillFile: string;
}>;

export type AdmittedMcpServer = Readonly<{
  kind: "mcp-server";
  componentId: string;
  serverId: string;
  config:
    | {
        type: "stdio";
        command: string;
        args: string[];
        env: Record<string, string>;
        cwd?: string;
      }
    | {
        type: "streamable-http" | "sse";
        url: string;
        headers: Record<string, string>;
      };
}>;

export type ExtensionPackageAdmission = Readonly<{
  adapterId: "agent-plugins-1.0.0" | "skill-repo-1.0.0";
  pluginRoot: string;
  manifest: JsonObject;
  unknownManifestFields: readonly string[];
  components: readonly (AdmittedSkill | AdmittedMcpServer)[];
  diagnostics: readonly ExtensionAdmissionDiagnostic[];
  valid: boolean;
  containsStdio: boolean;
}>;

export async function admitExtensionPackage(
  requestedRoot: string
): Promise<ExtensionPackageAdmission> {
  const diagnostics: ExtensionAdmissionDiagnostic[] = [];
  const pluginRoot = await canonicalDirectory(requestedRoot);
  const manifestPath = await containedExisting(pluginRoot, "plugin.json", "file");
  const parsed = parseJson(await readFile(manifestPath, "utf8"), "plugin.json");
  const { manifest, unknownFields, valid } = validateManifest(parsed, diagnostics);
  if (!valid) {
    return result(pluginRoot, manifest, unknownFields, [], diagnostics, false);
  }
  const components = [
    ...(await discoverSkills(pluginRoot, diagnostics)),
    ...(await discoverMcp(pluginRoot, diagnostics)),
  ];
  return result(pluginRoot, manifest, unknownFields, components, diagnostics, true);
}

function result(
  pluginRoot: string,
  manifest: JsonObject,
  unknownManifestFields: string[],
  components: (AdmittedSkill | AdmittedMcpServer)[],
  diagnostics: ExtensionAdmissionDiagnostic[],
  valid: boolean
): ExtensionPackageAdmission {
  return {
    adapterId: AGENT_PLUGIN_ADAPTER_ID,
    pluginRoot,
    manifest,
    unknownManifestFields,
    components,
    diagnostics,
    valid,
    containsStdio: components.some(
      (component) =>
        component.kind === "mcp-server" && component.config.type === "stdio"
    ),
  };
}

function validateManifest(
  value: unknown,
  diagnostics: ExtensionAdmissionDiagnostic[]
) {
  if (!isObject(value)) {
    diagnostics.push(error("package", "plugin.json", "manifest 顶层必须是对象"));
    return { manifest: {}, unknownFields: [], valid: false };
  }
  const manifest = { ...value };
  const unknownFields = Object.keys(manifest)
    .filter((field) => !MANIFEST_FIELDS.has(field))
    .sort();
  for (const field of unknownFields) {
    diagnostics.push({
      severity: "report",
      scope: "package",
      path: `plugin.json.${field}`,
      message: "Agent Plugins 1.0.0 未知顶层字段：已报告并忽略",
    });
    delete manifest[field];
  }
  const failures: string[] = [];
  if (manifest.$schema !== AGENT_PLUGIN_SCHEMA_1_0_0) {
    diagnostics.push({
      ...error(
        "package",
        "plugin.json",
        "$schema 不是受支持的 Agent Plugins 1.0.0 canonical id"
      ),
      code: "unsupported-version",
    });
    failures.push("unsupported-version");
  }
  if (typeof manifest.name !== "string" || !NAME_PATTERN.test(manifest.name)) {
    failures.push("name 不满足 1–64 位小写字母、数字、点与连字符约束");
  }
  for (const field of [
    "version",
    "description",
    "homepage",
    "repository",
    "license",
  ]) {
    if (manifest[field] !== undefined && typeof manifest[field] !== "string") {
      failures.push(`${field} 必须是字符串`);
    }
  }
  if (
    manifest.keywords !== undefined &&
    (!Array.isArray(manifest.keywords) ||
      manifest.keywords.some((item) => typeof item !== "string"))
  ) {
    failures.push("keywords 必须是字符串数组");
  }
  if (manifest.author !== undefined && !validAuthor(manifest.author)) {
    failures.push("author 必须是只含 name/email/url 字符串的对象");
  }
  if (manifest.extensions !== undefined && !isObject(manifest.extensions)) {
    diagnostics.push({
      severity: "report",
      scope: "package",
      path: "plugin.json.extensions",
      message: "非对象 extensions 已报告并忽略，不阻断其它有效字段",
    });
    delete manifest.extensions;
  } else if (
    isObject(manifest.extensions) &&
    Object.values(manifest.extensions).some((entry) => !isObject(entry))
  ) {
    failures.push("extensions 的每个 namespace 值必须是对象");
  }
  failures.filter((message) => message !== "unsupported-version").forEach((message) =>
    diagnostics.push(error("package", "plugin.json", message))
  );
  return { manifest, unknownFields, valid: failures.length === 0 };
}

export async function discoverSkills(
  root: string,
  diagnostics: ExtensionAdmissionDiagnostic[]
) {
  const skillsRoot = await optionalContained(root, "skills", "directory", diagnostics);
  if (!skillsRoot) return [];
  const components: AdmittedSkill[] = [];
  for (const entry of (await readdir(skillsRoot, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name)
  )) {
    if (!entry.isDirectory()) continue;
    const relativeFile = `skills/${entry.name}/SKILL.md`;
    try {
      const skillFile = await containedExisting(root, relativeFile, "file");
      const content = await readFile(skillFile, "utf8");
      const parsed = parseStrictSkillFrontmatter(content);
      components.push({
        kind: "skill",
        componentId: `skill:${entry.name}`,
        name: parsed.name,
        description: parsed.description,
        ...(parsed.requires ? { requires: parsed.requires } : {}),
        skillFile,
      });
    } catch (cause) {
      diagnostics.push(
        error("component", relativeFile, `跳过无效 skill：${messageOf(cause)}`)
      );
    }
  }
  return components;
}

/** admission 不借 catalog 的展示回退；包声称了 frontmatter 就必须把契约说全。 */
export function parseStrictSkillFrontmatter(content: string) {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    throw new Error("SKILL.md 缺少 frontmatter opener");
  }
  const block = SKILL_FRONTMATTER_PATTERN.exec(content)?.[1];
  if (block === undefined) throw new Error("SKILL.md 缺少 frontmatter closer");
  const fields = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.+?)\s*$/.exec(line);
    if (match) fields.set(match[1]!, match[2]!.replace(/^['"]|['"]$/g, ""));
  }
  const name = fields.get("name")?.trim();
  const description = fields.get("description")?.trim();
  const requires = fields.get("requires")?.trim();
  if (!name) throw new Error("SKILL.md frontmatter 缺少 name");
  if (!description) throw new Error("SKILL.md frontmatter 缺少 description");
  return { name, description, ...(requires ? { requires } : {}) };
}

async function discoverMcp(
  root: string,
  diagnostics: ExtensionAdmissionDiagnostic[]
) {
  const path = await optionalContained(root, "mcp.json", "file", diagnostics);
  if (!path) return [];
  let parsed: unknown;
  try {
    parsed = parseJson(await readFile(path, "utf8"), "mcp.json");
  } catch (cause) {
    diagnostics.push(error("mcp", "mcp.json", messageOf(cause)));
    return [];
  }
  if (
    !isObject(parsed) ||
    Object.keys(parsed).some((key) => key !== "$schema" && key !== "mcpServers") ||
    parsed.$schema !== AGENT_PLUGIN_MCP_SCHEMA_1_0_0 ||
    !isObject(parsed.mcpServers)
  ) {
    diagnostics.push(
      error("mcp", "mcp.json", "MCP 顶层 schema/version/字段无效，已独立禁用 MCP")
    );
    return [];
  }
  const components: AdmittedMcpServer[] = [];
  for (const [serverId, value] of Object.entries(parsed.mcpServers).sort()) {
    try {
      components.push(await validateServer(root, serverId, value));
    } catch (cause) {
      diagnostics.push(
        error("component", `mcp.json.mcpServers.${serverId}`, messageOf(cause))
      );
    }
  }
  return components;
}

async function validateServer(
  root: string,
  serverId: string,
  value: unknown
): Promise<AdmittedMcpServer> {
  if (!SERVER_ID_PATTERN.test(serverId) || !isObject(value)) {
    throw new Error("server id 或配置对象无效");
  }
  if (value.type === "stdio") {
    assertExactKeys(value, ["type", "command", "args", "env", "cwd"]);
    if (typeof value.command !== "string") throw new Error("stdio command 必填");
    await validateCommand(root, value.command);
    const args = stringArray(value.args, "args");
    const env = stringRecord(value.env, "env");
    if (Object.keys(env).some((key) => key.toUpperCase() === "PLUGIN_ROOT" || key.toUpperCase() === "PLUGIN_DATA")) {
      throw new Error("env 不能覆盖 PLUGIN_ROOT/PLUGIN_DATA");
    }
    const cwd = optionalString(value.cwd, "cwd");
    if (cwd) validateCwd(root, cwd);
    return {
      kind: "mcp-server",
      componentId: `mcp:${serverId}`,
      serverId,
      config: { type: "stdio", command: value.command, args, env, ...(cwd ? { cwd } : {}) },
    };
  }
  if (value.type !== "streamable-http" && value.type !== "sse") {
    throw new Error("未知 MCP transport");
  }
  assertExactKeys(value, ["type", "url", "headers"]);
  if (typeof value.url !== "string") throw new Error("remote url 必填");
  validateRemoteUrl(value.url);
  const headers = stringRecord(value.headers, "headers");
  const seen = new Set<string>();
  for (const [name, headerValue] of Object.entries(headers)) {
    const canonical = name.toLowerCase();
    if (seen.has(canonical)) throw new Error(`header 大小写重复：${name}`);
    seen.add(canonical);
    validateHeaderName(name);
    validateHeaderValue(name, headerValue);
  }
  return {
    kind: "mcp-server",
    componentId: `mcp:${serverId}`,
    serverId,
    config: { type: value.type, url: value.url, headers },
  };
}

async function validateCommand(root: string, command: string) {
  if (command.startsWith("./")) {
    await containedExisting(root, command, "file");
    return;
  }
  if (!BARE_COMMAND_PATTERN.test(command)) {
    throw new Error("command 必须是 bare executable 或 ./plugin-relative 单 token");
  }
}

function validateCwd(root: string, cwd: string) {
  if (cwd === "${PLUGIN_ROOT}" || cwd.startsWith("${PLUGIN_ROOT}/")) {
    assertLexicalContainment(root, cwd.replace("${PLUGIN_ROOT}", "."));
    return;
  }
  if (cwd === "${PLUGIN_DATA}" || cwd.startsWith("${PLUGIN_DATA}/")) {
    if (cwd.split("/").includes("..")) throw new Error("cwd 逃逸 PLUGIN_DATA");
    return;
  }
  if (!cwd.startsWith("./")) throw new Error("cwd 不是规范允许的 rooted form");
  assertLexicalContainment(root, cwd);
}

function validateRemoteUrl(raw: string) {
  const url = new URL(raw);
  if (!/^(http:|https:)$/.test(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("remote URL 必须是无 userinfo/fragment 的 HTTP(S) 绝对地址");
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname.startsWith("127.");
  if (!loopback && url.protocol !== "https:") {
    throw new Error("非 loopback remote MCP 必须使用 HTTPS");
  }
}

export async function canonicalDirectory(path: string) {
  if (!isAbsolute(path)) throw new Error("plugin root 必须是绝对路径");
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isDirectory()) throw new Error("plugin root 不是目录");
  return canonical;
}

async function optionalContained(
  root: string,
  path: string,
  kind: "file" | "directory",
  diagnostics: ExtensionAdmissionDiagnostic[]
) {
  try {
    return await containedExisting(root, path, kind);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    diagnostics.push(error(kind === "file" ? "mcp" : "skills", path, messageOf(cause)));
    return null;
  }
}

async function containedExisting(
  root: string,
  path: string,
  kind: "file" | "directory"
) {
  assertLexicalContainment(root, path);
  const candidate = resolve(root, path);
  const metadata = await lstat(candidate);
  const canonical = await realpath(candidate);
  assertCanonicalContainment(root, canonical);
  if (kind === "file" ? !metadata.isFile() : !metadata.isDirectory()) {
    throw new Error(`${path} 不是${kind === "file" ? "普通文件" : "目录"}`);
  }
  return canonical;
}

function assertLexicalContainment(root: string, path: string) {
  const candidate = resolve(root, path);
  assertCanonicalContainment(root, candidate);
}

function assertCanonicalContainment(root: string, candidate: string) {
  const offset = relative(root, candidate);
  if (offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    throw new Error("package path 逃逸 plugin root");
  }
}

function parseJson(content: string, label: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${label} 不是合法 JSON`);
  }
}

function validAuthor(value: unknown) {
  return (
    isObject(value) &&
    Object.keys(value).every((key) => ["name", "email", "url"].includes(key)) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function assertExactKeys(value: JsonObject, allowed: string[]) {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) throw new Error(`未知/跨 variant 字段：${extra.join(", ")}`);
}

function stringArray(value: unknown, field: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${field} 必须是字符串数组`);
  }
  return [...value] as string[];
}

function stringRecord(value: unknown, field: string) {
  if (value === undefined) return {};
  if (!isObject(value) || Object.values(value).some((entry) => typeof entry !== "string")) {
    throw new Error(`${field} 必须是 string map`);
  }
  return { ...value } as Record<string, string>;
}

function optionalString(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} 必须是字符串`);
  return value;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function error(
  scope: ExtensionAdmissionDiagnostic["scope"],
  path: string,
  message: string
): ExtensionAdmissionDiagnostic {
  return { severity: "error", scope, path, message };
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
