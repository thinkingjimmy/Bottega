/**
 * [INPUT]: Depends on Node crypto/path, zod, the JsonCasStore persistence kernel, neutral resource scope, and shared masked MCP contracts
 * [OUTPUT]: Provides scope-aware ManualMcpServersStore v2 with exact projections, per-scope CAS tombstones, owner fences, retryable active+backup secret cleanup, budgets, and resolved main-only configs
 * [POS]: Main-only secret source of truth for manual MCP; global and exact-Project ownership is enforced before renderer projection or runtime resolution
 */

import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import type {
  ManualMcpEligibility,
  ManualMcpServerView,
  McpSecretEdit,
  McpServersChangedEvent,
  McpServersSnapshot,
  RemoveManualMcpServerInput,
  SaveManualMcpServerInput,
} from "../../../../shared/mcp-servers-ipc";
import type { ProductResourceScope } from "../../../../shared/resource-scope";
import { PROJECT_ID_PATTERN } from "../../../../shared/projects-ipc";
import {
  JsonCasStore,
  byteLength,
  serialize,
  storeError,
  type JsonCasStoreDependencies,
} from "../json-cas-store";

const SCHEMA_VERSION = 2;
const MAX_SERVERS_PER_SCOPE = 32;
const MAX_TOTAL_SERVERS = 512;
const MAX_SCOPE_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SERVER_BYTES = 16 * 1024;
const MAX_NAME_BYTES = 128;
const MAX_COMMAND_BYTES = 4 * 1024;
const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_BYTES = 4 * 1024;
const MAX_SECRET_ENTRIES = 64;
const MAX_SECRET_NAME_BYTES = 128;
const MAX_SECRET_VALUE_BYTES = 8 * 1024;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const MANUAL_ID = /^manual:[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MASKED = "••••••••" as const;

const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z.object({ kind: z.literal("project"), projectId: z.string().regex(PROJECT_ID_PATTERN) }).strict(),
]);
const secretRecordSchema = z.record(z.string(), z.string());
const stdioSchema = z.object({
  transport: z.literal("stdio"), command: z.string(), args: z.array(z.string()), env: secretRecordSchema,
}).strict();
const remoteSchema = z.object({
  transport: z.enum(["streamable-http", "sse"]), url: z.string(), headers: secretRecordSchema,
}).strict();
const serverFields = {
  serverId: z.string().regex(MANUAL_ID),
  displayName: z.string(),
  enabled: z.boolean(),
  config: z.discriminatedUnion("transport", [stdioSchema, remoteSchema]),
};
const serverSchema = z.object({ ...serverFields, scope: scopeSchema }).strict();
const fileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  scopeRevisions: z.record(z.string(), z.number().int().nonnegative()),
  servers: z.array(serverSchema),
}).strict();

type StoredServer = z.infer<typeof serverSchema>;
type StoreFile = z.infer<typeof fileSchema>;
type ServerConfig = StoredServer["config"];

export type ResolvedManualMcpServer = Readonly<StoredServer & {
  configDigest: `sha256:${string}`;
  eligibility: ManualMcpEligibility;
}>;

const emptyFile = (): StoreFile => ({
  schemaVersion: SCHEMA_VERSION,
  revision: 0,
  scopeRevisions: { global: 0 },
  servers: [],
});

export class ManualMcpServersStore extends JsonCasStore<StoreFile, McpServersChangedEvent> {
  constructor(userData: string, dependencies: JsonCasStoreDependencies = {}) {
    super({
      filePath: join(userData, "mcp-servers.json"),
      label: "mcp-servers.json",
      maxFileBytes: MAX_FILE_BYTES,
      empty: emptyFile,
      validate: validateState,
      dependencies,
    });
  }

  initialize() {
    return this.mutate(async () => {
      await this.recover();
      return this.project({ kind: "global" });
    });
  }

  project(
    queryScope: ProductResourceScope = { kind: "global" },
    projectLifecycleRevision: number | null = null
  ): McpServersSnapshot {
    const scope = parseScope(queryScope);
    return {
      queryScope: scope,
      storeRevision: this.state.revision,
      globalScopeRevision: this.scopeRevision({ kind: "global" }),
      projectScopeRevision: scope.kind === "project" ? this.scopeRevision(scope) : null,
      projectLifecycleRevision: scope.kind === "project" ? projectLifecycleRevision : null,
      servers: this.visibleServers(scope).map(projectServer),
    };
  }

  resolved(scope: ProductResourceScope = { kind: "global" }): readonly ResolvedManualMcpServer[] {
    return this.visibleServers(parseScope(scope)).map(resolveServer);
  }

  owned(scope: ProductResourceScope): readonly ResolvedManualMcpServer[] {
    const parsed = parseScope(scope);
    return this.state.servers.filter((server) => sameScope(server.scope, parsed)).map(resolveServer);
  }

  scopeRevision(scope: ProductResourceScope) {
    return this.state.scopeRevisions[scopeKey(parseScope(scope))] ?? 0;
  }

  save(raw: SaveManualMcpServerInput) {
    return this.mutate(async () => {
      const input = parseSave(raw);
      this.assertScopeRevision(input.scope, input.expectedScopeRevision);
      const existing = input.serverId
        ? this.state.servers.find((server) => server.serverId === input.serverId)
        : undefined;
      if (input.serverId && !existing) throw storeError("owner-mismatch", "MCP server 不存在");
      if (existing && !sameScope(existing.scope, input.scope)) {
        throw storeError("owner-mismatch", "MCP server owner 与 mutation scope 不一致");
      }
      const ownedCount = this.state.servers.filter((server) => sameScope(server.scope, input.scope)).length;
      if (!existing && ownedCount >= MAX_SERVERS_PER_SCOPE) {
        throw new Error(`每个 scope 最多 ${MAX_SERVERS_PER_SCOPE} 个 MCP server`);
      }
      if (!existing && this.state.servers.length >= MAX_TOTAL_SERVERS) {
        throw new Error(`MCP server 总数最多 ${MAX_TOTAL_SERVERS} 个`);
      }
      const next: StoredServer = {
        serverId: existing?.serverId ?? this.nextId(input.draft.displayName),
        scope: input.scope,
        displayName: bounded("显示名称", input.draft.displayName.trim(), MAX_NAME_BYTES),
        enabled: input.draft.enabled,
        config: resolveConfig(input.draft.config, existing?.config),
      };
      const servers = existing
        ? this.state.servers.map((server) => server.serverId === existing.serverId ? next : server)
        : [...this.state.servers, next];
      await this.commit(input.scope, servers);
      return this.project(input.scope, input.expectedProjectLifecycleRevision);
    });
  }

  remove(raw: RemoveManualMcpServerInput) {
    return this.mutate(async () => {
      const input = parseRemove(raw);
      this.assertScopeRevision(input.scope, input.expectedScopeRevision);
      const existing = this.state.servers.find((server) => server.serverId === input.serverId);
      if (!existing || !sameScope(existing.scope, input.scope)) {
        throw storeError("owner-mismatch", "MCP server owner 与 mutation scope 不一致");
      }
      await this.commit(input.scope, this.state.servers.filter((server) => server.serverId !== input.serverId));
      return this.project(input.scope, input.expectedProjectLifecycleRevision);
    });
  }

  cleanupProject(projectId: string) {
    const scope = parseScope({ kind: "project", projectId });
    return this.mutate(async () => {
      const key = scopeKey(scope);
      const servers = this.state.servers.filter((server) => !sameScope(server.scope, scope));
      const hadServers = servers.length !== this.state.servers.length;
      const hadRevision = Object.hasOwn(this.state.scopeRevisions, key);
      if (hadServers || hadRevision) {
        const scopeRevisions = { ...this.state.scopeRevisions };
        delete scopeRevisions[key];
        await this.commitFile({ servers, scopeRevisions }, undefined);
      }
      await this.rewriteBackup();
      return hadServers || hadRevision;
    });
  }

  private visibleServers(scope: ProductResourceScope) {
    return this.state.servers.filter((server) =>
      server.scope.kind === "global" || sameScope(server.scope, scope)
    );
  }

  private assertScopeRevision(scope: ProductResourceScope, expected: number) {
    if (!Number.isInteger(expected) || expected < 0) throw new Error("MCP scope revision 无效");
    if (this.scopeRevision(scope) !== expected) {
      throw storeError("scope-revision-conflict", "MCP scope 已变化，请刷新后重试");
    }
  }

  private nextId(displayName: string): `manual:${string}` {
    const base = slug(displayName);
    const used = new Set(this.state.servers.map((server) => server.serverId));
    let candidate = `manual:${base}` as `manual:${string}`;
    for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `manual:${base}-${suffix}`;
    return candidate;
  }

  private async commit(scope: ProductResourceScope, servers: StoredServer[]) {
    const key = scopeKey(scope);
    const scopeRevisions = {
      ...this.state.scopeRevisions,
      [key]: (this.state.scopeRevisions[key] ?? 0) + 1,
    };
    await this.commitFile({ servers, scopeRevisions }, {
      version: {
        scope: structuredClone(scope),
        projectLifecycleRevision: null,
        scopeRevision: scopeRevisions[key]!,
      },
      storeRevision: this.state.revision + 1,
    });
  }

  private commitFile(
    changed: Pick<StoreFile, "servers" | "scopeRevisions">,
    event: McpServersChangedEvent | undefined
  ) {
    const next = validateState({
      schemaVersion: SCHEMA_VERSION,
      revision: this.state.revision + 1,
      ...changed,
    });
    return this.commitState(next, event ? [event] : []);
  }
}

function parseSave(raw: SaveManualMcpServerInput): SaveManualMcpServerInput {
  if (!raw || typeof raw !== "object") throw new Error("MCP server 参数无效");
  const scope = parseScope(raw.scope);
  assertLifecycleFence(scope, raw.expectedProjectLifecycleRevision);
  if (!Number.isInteger(raw.expectedScopeRevision) || raw.expectedScopeRevision < 0) throw new Error("MCP scope revision 无效");
  if (raw.serverId !== undefined && !MANUAL_ID.test(raw.serverId)) throw new Error("MCP serverId 无效");
  if (!raw.draft || typeof raw.draft !== "object") throw new Error("MCP server draft 无效");
  if (typeof raw.draft.displayName !== "string" || !raw.draft.displayName.trim()) throw new Error("MCP server 显示名称不能为空");
  if (typeof raw.draft.enabled !== "boolean") throw new Error("MCP server enabled 无效");
  return { ...raw, scope } as SaveManualMcpServerInput;
}

function parseRemove(raw: RemoveManualMcpServerInput): RemoveManualMcpServerInput {
  if (!raw || typeof raw !== "object") throw new Error("MCP server 删除参数无效");
  const scope = parseScope(raw.scope);
  assertLifecycleFence(scope, raw.expectedProjectLifecycleRevision);
  if (!Number.isInteger(raw.expectedScopeRevision) || raw.expectedScopeRevision < 0) throw new Error("MCP scope revision 无效");
  if (!MANUAL_ID.test(raw.serverId)) throw new Error("MCP serverId 无效");
  return { ...raw, scope } as RemoveManualMcpServerInput;
}

function assertLifecycleFence(scope: ProductResourceScope, revision: number | null) {
  if (scope.kind === "global" && revision !== null) throw new Error("global mutation 不接受 Project lifecycle revision");
  if (scope.kind === "project" && (!Number.isInteger(revision) || (revision ?? 0) <= 0)) {
    throw new Error("Project lifecycle revision 无效");
  }
}

function parseScope(scope: ProductResourceScope): ProductResourceScope {
  return scopeSchema.parse(scope);
}

function scopeKey(scope: ProductResourceScope) {
  return scope.kind === "global" ? "global" : `project:${scope.projectId}`;
}

function sameScope(left: ProductResourceScope, right: ProductResourceScope) {
  return scopeKey(left) === scopeKey(right);
}

function resolveConfig(draft: SaveManualMcpServerInput["draft"]["config"], existing: ServerConfig | undefined): ServerConfig {
  if (!draft || typeof draft !== "object") throw new Error("MCP transport 无效");
  if (draft.transport === "stdio") {
    if (!isAbsolute(draft.command)) throw new Error("MCP command 必须是绝对路径");
    bounded("MCP command", draft.command, MAX_COMMAND_BYTES);
    if (!Array.isArray(draft.args) || draft.args.length > MAX_ARGUMENTS) throw new Error(`MCP args 最多 ${MAX_ARGUMENTS} 项`);
    const args = draft.args.map((argument) => {
      if (typeof argument !== "string") throw new Error("MCP arg 必须是字符串");
      return bounded("MCP arg", argument, MAX_ARGUMENT_BYTES);
    });
    const previous = existing?.transport === "stdio" ? existing.env : {};
    return { transport: "stdio", command: draft.command, args, env: resolveSecrets(draft.env, previous, ENV_NAME, "环境变量") };
  }
  if (draft.transport !== "streamable-http" && draft.transport !== "sse") throw new Error("MCP transport 无效");
  let parsed: URL;
  try { parsed = new URL(draft.url); } catch { throw new Error("MCP remote URL 无效"); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("MCP remote URL 只支持 HTTP(S)");
  const previous = existing?.transport === draft.transport ? existing.headers : {};
  return { transport: draft.transport, url: parsed.toString(), headers: resolveSecrets(draft.headers, previous, HEADER_NAME, "Header") };
}

function resolveSecrets(edits: readonly McpSecretEdit[], previous: Record<string, string>, pattern: RegExp, label: string) {
  if (!Array.isArray(edits) || edits.length > MAX_SECRET_ENTRIES) throw new Error(`${label} 最多 ${MAX_SECRET_ENTRIES} 项`);
  const resolved: Record<string, string> = {};
  for (const edit of edits) {
    if (!edit || typeof edit !== "object" || typeof edit.name !== "string") throw new Error(`${label} 编辑无效`);
    const name = bounded(`${label}名`, edit.name.trim(), MAX_SECRET_NAME_BYTES);
    if (!pattern.test(name)) throw new Error(`${label}名格式无效：${name}`);
    if (Object.hasOwn(resolved, name)) throw new Error(`${label}名重复：${name}`);
    if (edit.action === "clear") continue;
    if (edit.action === "keep") {
      if (!Object.hasOwn(previous, name)) throw new Error(`${label} ${name} 没有可保留的旧值`);
      resolved[name] = previous[name]!;
      continue;
    }
    if (edit.action !== "replace" || typeof edit.value !== "string") throw new Error(`${label} ${name} 的编辑动作无效`);
    resolved[name] = bounded(`${label}值`, edit.value, MAX_SECRET_VALUE_BYTES);
  }
  return resolved;
}

function validateState(raw: unknown): StoreFile {
  const state = fileSchema.parse(raw);
  if (!Object.hasOwn(state.scopeRevisions, "global")) throw new Error("MCP 缺少 global scope revision");
  if (state.servers.length > MAX_TOTAL_SERVERS) throw new Error(`MCP server 总数最多 ${MAX_TOTAL_SERVERS} 个`);
  const ids = new Set<string>();
  const grouped = new Map<string, StoredServer[]>();
  for (const [key, revision] of Object.entries(state.scopeRevisions)) {
    if (key !== "global" && !key.startsWith("project:")) throw new Error(`MCP scope key 无效：${key}`);
    if (key.startsWith("project:") && !PROJECT_ID_PATTERN.test(key.slice(8))) throw new Error(`MCP Project scope 无效：${key}`);
    if (!Number.isInteger(revision) || revision < 0) throw new Error(`MCP scope revision 无效：${key}`);
  }
  for (const server of state.servers) {
    if (ids.has(server.serverId)) throw new Error(`MCP serverId 重复：${server.serverId}`);
    ids.add(server.serverId);
    const key = scopeKey(server.scope);
    if (!Object.hasOwn(state.scopeRevisions, key)) throw new Error(`MCP server scope 缺少 revision：${key}`);
    const group = grouped.get(key) ?? [];
    group.push(server);
    grouped.set(key, group);
    bounded("显示名称", server.displayName, MAX_NAME_BYTES);
    if (byteLength(JSON.stringify(server)) > MAX_SERVER_BYTES) throw new Error(`MCP server ${server.serverId} 超过单条字节预算`);
    validateConfig(server.config);
  }
  for (const [key, servers] of grouped) {
    if (servers.length > MAX_SERVERS_PER_SCOPE) throw new Error(`MCP scope ${key} server 过多`);
    if (byteLength(JSON.stringify(servers)) > MAX_SCOPE_BYTES) throw new Error(`MCP scope ${key} 超过字节预算`);
  }
  if (byteLength(serialize(state)) > MAX_FILE_BYTES) throw new Error("MCP server 配置超过总字节预算");
  return state;
}

function validateConfig(config: ServerConfig) {
  const secrets = config.transport === "stdio" ? config.env : config.headers;
  resolveConfig(config.transport === "stdio"
    ? { ...config, env: Object.entries(secrets).map(([name, value]) => ({ name, action: "replace" as const, value })) }
    : { ...config, headers: Object.entries(secrets).map(([name, value]) => ({ name, action: "replace" as const, value })) }, undefined);
}

function projectServer(server: StoredServer): ManualMcpServerView {
  const eligibility = eligibilityOf(server);
  const base = {
    serverId: server.serverId as `manual:${string}`,
    source: "manual" as const,
    owner: structuredClone(server.scope),
    displayName: server.displayName,
    configuredEnabled: server.enabled,
    enabled: server.enabled,
    override: null,
    effectiveState: eligibility !== "eligible" ? "unavailable" as const : server.enabled ? "enabled" as const : "disabled" as const,
    effectiveSource: server.scope.kind === "global" ? "global-default" as const : "project-owned" as const,
    backendSupport: [],
    eligibility,
    configDigest: digest(server.config),
    health: { state: "unobserved" as const, revision: 0, detail: "尚无协议层成功或失败证据" },
  };
  return server.config.transport === "stdio"
    ? { ...base, transport: "stdio", command: server.config.command, args: [...server.config.args], env: maskedSecrets(server.config.env) }
    : { ...base, transport: server.config.transport, url: server.config.url, headers: maskedSecrets(server.config.headers) };
}

function resolveServer(server: StoredServer): ResolvedManualMcpServer {
  return { ...structuredClone(server), configDigest: digest(server.config), eligibility: eligibilityOf(server) };
}

function maskedSecrets(values: Record<string, string>) {
  return Object.keys(values).sort().map((name) => ({ name, hasValue: true as const, maskedValue: MASKED }));
}

function eligibilityOf(server: StoredServer): ManualMcpEligibility {
  if (server.config.transport === "stdio") return "eligible";
  if (Object.keys(server.config.headers).length) return "authenticated-remote-unsupported";
  if (new URL(server.config.url).search) return "query-remote-unsupported";
  return "remote-policy-unsupported";
}

function bounded(label: string, value: string, maximum: number) {
  if (byteLength(value) > maximum) throw new Error(`${label} 超过 ${maximum} 字节`);
  return value;
}

function slug(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "server";
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonical(entry)]));
}
