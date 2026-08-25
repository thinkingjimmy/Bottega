/**
 * [INPUT]: Depends on Node fs/crypto/path, zod and shared MCP save/remove agreement
 * [OUTPUT]: Provides ManualMcpServersStore: strict v1, monotone revision, 0600 atomic writing, budget testing, masked projection and resolution of the canonical sha256 front receipt snapshot
 * [POS]: The source of config truth for tools/mcp; The disk script stops at main, the renderer only consumes project() projection
 */

import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import type {
  ManualMcpEligibility,
  ManualMcpServerView,
  McpSecretEdit,
  McpServersSnapshot,
  RemoveManualMcpServerInput,
  SaveManualMcpServerInput,
} from "../../../../shared/mcp-servers-ipc";

const SCHEMA_VERSION = 1;
const MAX_SERVERS = 32;
const MAX_FILE_BYTES = 64 * 1024;
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

const byteLength = (value: string) => Buffer.byteLength(value, "utf8");
const bounded = (label: string, value: string, maximum: number) => {
  if (byteLength(value) > maximum) throw new Error(`${label} 超过 ${maximum} 字节`);
  return value;
};

const secretRecordSchema = z.record(z.string(), z.string());
const stdioSchema = z
  .object({
    transport: z.literal("stdio"),
    command: z.string(),
    args: z.array(z.string()),
    env: secretRecordSchema,
  })
  .strict();
const remoteSchema = z
  .object({
    transport: z.enum(["streamable-http", "sse"]),
    url: z.string(),
    headers: secretRecordSchema,
  })
  .strict();
const serverSchema = z
  .object({
    serverId: z.string().regex(MANUAL_ID),
    displayName: z.string(),
    enabled: z.boolean(),
    config: z.discriminatedUnion("transport", [stdioSchema, remoteSchema]),
  })
  .strict();
const fileSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    servers: z.array(serverSchema),
  })
  .strict();

type StoredServer = z.infer<typeof serverSchema>;
type StoreFile = z.infer<typeof fileSchema>;

export type ResolvedManualMcpServer = Readonly<StoredServer & {
  configDigest: `sha256:${string}`;
  eligibility: ManualMcpEligibility;
}>;

const EMPTY: StoreFile = { schemaVersion: SCHEMA_VERSION, revision: 0, servers: [] };

export class ManualMcpServersStore {
  readonly filePath: string;
  private state: StoreFile = structuredClone(EMPTY);
  private queue: Promise<void> = Promise.resolve();
  private readonly watchers = new Set<(snapshot: McpServersSnapshot) => void>();

  constructor(private readonly userData: string) {
    this.filePath = join(userData, "mcp-servers.json");
  }

  async initialize() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      if (byteLength(raw) > MAX_FILE_BYTES) throw new Error("配置文件超过总字节预算");
      this.state = fileSchema.parse(JSON.parse(raw));
      validateState(this.state);
      await chmod(this.filePath, 0o600);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("mcp-servers.json 损坏或不受支持", { cause });
      }
      await this.persist(this.state);
    }
    return this.project();
  }

  project(): McpServersSnapshot {
    return {
      revision: this.state.revision,
      servers: this.state.servers.map(projectServer),
    };
  }

  resolved(): readonly ResolvedManualMcpServer[] {
    return this.state.servers.map((server) => ({
      ...structuredClone(server),
      configDigest: digest(server.config),
      eligibility: eligibilityOf(server),
    }));
  }

  onChanged(listener: (snapshot: McpServersSnapshot) => void) {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  save(raw: SaveManualMcpServerInput) {
    return this.mutate(async () => {
      const input = parseSave(raw);
      this.assertRevision(input.expectedRevision);
      const existing = input.serverId
        ? this.state.servers.find((server) => server.serverId === input.serverId)
        : undefined;
      if (input.serverId && !existing) throw new Error("MCP server 不存在");
      if (!input.serverId && this.state.servers.length >= MAX_SERVERS) {
        throw new Error(`MCP server 最多 ${MAX_SERVERS} 个`);
      }
      const next: StoredServer = {
        serverId: existing?.serverId ?? this.nextId(input.draft.displayName),
        displayName: bounded("显示名称", input.draft.displayName.trim(), MAX_NAME_BYTES),
        enabled: input.draft.enabled,
        config: resolveConfig(input.draft.config, existing?.config),
      };
      const servers = existing
        ? this.state.servers.map((server) =>
            server.serverId === existing.serverId ? next : server
          )
        : [...this.state.servers, next];
      await this.commit(servers);
      return this.project();
    });
  }

  remove(raw: RemoveManualMcpServerInput) {
    return this.mutate(async () => {
      const input = parseRemove(raw);
      this.assertRevision(input.expectedRevision);
      const servers = this.state.servers.filter(
        (server) => server.serverId !== input.serverId
      );
      if (servers.length === this.state.servers.length) {
        throw new Error("MCP server 不存在");
      }
      await this.commit(servers);
      return this.project();
    });
  }

  private mutate<T>(operation: () => Promise<T>) {
    const result = this.queue.then(operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private assertRevision(expected: number) {
    if (expected !== this.state.revision) {
      throw new Error("MCP server 配置已变化，请刷新后重试");
    }
  }

  private nextId(displayName: string): `manual:${string}` {
    const base = slug(displayName);
    const used = new Set(this.state.servers.map((server) => server.serverId));
    let candidate = `manual:${base}` as const;
    for (let suffix = 2; used.has(candidate); suffix += 1) {
      candidate = `manual:${base}-${suffix}`;
    }
    return candidate;
  }

  private async commit(servers: StoredServer[]) {
    const next: StoreFile = {
      schemaVersion: SCHEMA_VERSION,
      revision: this.state.revision + 1,
      servers,
    };
    validateState(next);
    await this.persist(next);
    this.state = next;
    const snapshot = this.project();
    for (const watcher of this.watchers) watcher(snapshot);
  }

  private async persist(state: StoreFile) {
    await mkdir(this.userData, { recursive: true });
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    if (byteLength(serialized) > MAX_FILE_BYTES) {
      throw new Error(`MCP server 配置总量超过 ${MAX_FILE_BYTES} 字节`);
    }
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, serialized, { mode: 0o600 });
    const temporaryFile = await open(temporary, "r");
    await temporaryFile.sync();
    await temporaryFile.close();
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600);
    const directory = await open(this.userData, "r");
    await directory.sync();
    await directory.close();
  }
}

function parseSave(raw: SaveManualMcpServerInput): SaveManualMcpServerInput {
  if (!raw || typeof raw !== "object") throw new Error("MCP server 参数无效");
  const value = raw as SaveManualMcpServerInput;
  if (!Number.isInteger(value.expectedRevision) || value.expectedRevision < 0) {
    throw new Error("MCP server revision 无效");
  }
  if (value.serverId !== undefined && !MANUAL_ID.test(value.serverId)) {
    throw new Error("MCP serverId 无效");
  }
  if (!value.draft || typeof value.draft !== "object") {
    throw new Error("MCP server draft 无效");
  }
  if (typeof value.draft.displayName !== "string" || !value.draft.displayName.trim()) {
    throw new Error("MCP server 显示名称不能为空");
  }
  if (typeof value.draft.enabled !== "boolean") throw new Error("MCP server enabled 无效");
  return value;
}

function parseRemove(raw: RemoveManualMcpServerInput): RemoveManualMcpServerInput {
  if (!raw || typeof raw !== "object") throw new Error("MCP server 删除参数无效");
  if (!Number.isInteger(raw.expectedRevision) || raw.expectedRevision < 0) {
    throw new Error("MCP server revision 无效");
  }
  if (!MANUAL_ID.test(raw.serverId)) throw new Error("MCP serverId 无效");
  return raw;
}

function resolveConfig(
  draft: SaveManualMcpServerInput["draft"]["config"],
  existing: StoredServer["config"] | undefined
): StoredServer["config"] {
  if (!draft || typeof draft !== "object") throw new Error("MCP transport 无效");
  if (draft.transport === "stdio") {
    if (!isAbsolute(draft.command)) throw new Error("MCP command 必须是绝对路径");
    bounded("MCP command", draft.command, MAX_COMMAND_BYTES);
    if (!Array.isArray(draft.args) || draft.args.length > MAX_ARGUMENTS) {
      throw new Error(`MCP args 最多 ${MAX_ARGUMENTS} 项`);
    }
    const args = draft.args.map((argument) => {
      if (typeof argument !== "string") throw new Error("MCP arg 必须是字符串");
      return bounded("MCP arg", argument, MAX_ARGUMENT_BYTES);
    });
    const previous = existing?.transport === "stdio" ? existing.env : {};
    return {
      transport: "stdio",
      command: draft.command,
      args,
      env: resolveSecrets(draft.env, previous, ENV_NAME, "环境变量"),
    };
  }
  if (draft.transport !== "streamable-http" && draft.transport !== "sse") {
    throw new Error("MCP transport 无效");
  }
  let parsed: URL;
  try {
    parsed = new URL(draft.url);
  } catch {
    throw new Error("MCP remote URL 无效");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("MCP remote URL 只支持 HTTP(S)");
  }
  const previous = existing?.transport === draft.transport ? existing.headers : {};
  return {
    transport: draft.transport,
    url: parsed.toString(),
    headers: resolveSecrets(draft.headers, previous, HEADER_NAME, "Header"),
  };
}

function resolveSecrets(
  edits: readonly McpSecretEdit[],
  previous: Record<string, string>,
  namePattern: RegExp,
  label: string
) {
  if (!Array.isArray(edits) || edits.length > MAX_SECRET_ENTRIES) {
    throw new Error(`${label} 最多 ${MAX_SECRET_ENTRIES} 项`);
  }
  const resolved: Record<string, string> = {};
  for (const edit of edits) {
    if (!edit || typeof edit !== "object" || typeof edit.name !== "string") {
      throw new Error(`${label} 编辑无效`);
    }
    const name = bounded(`${label}名`, edit.name.trim(), MAX_SECRET_NAME_BYTES);
    if (!namePattern.test(name)) throw new Error(`${label}名格式无效：${name}`);
    if (Object.hasOwn(resolved, name)) throw new Error(`${label}名重复：${name}`);
    if (edit.action === "clear") continue;
    if (edit.action === "keep") {
      if (!Object.hasOwn(previous, name)) throw new Error(`${label} ${name} 没有可保留的旧值`);
      resolved[name] = previous[name]!;
      continue;
    }
    if (edit.action !== "replace" || typeof edit.value !== "string") {
      throw new Error(`${label} ${name} 的编辑动作无效`);
    }
    resolved[name] = bounded(`${label}值`, edit.value, MAX_SECRET_VALUE_BYTES);
  }
  return resolved;
}

function validateState(state: StoreFile) {
  if (state.servers.length > MAX_SERVERS) throw new Error(`MCP server 最多 ${MAX_SERVERS} 个`);
  const ids = new Set<string>();
  for (const server of state.servers) {
    if (ids.has(server.serverId)) throw new Error(`MCP serverId 重复：${server.serverId}`);
    ids.add(server.serverId);
    bounded("显示名称", server.displayName, MAX_NAME_BYTES);
    const serialized = JSON.stringify(server);
    if (byteLength(serialized) > MAX_SERVER_BYTES) {
      throw new Error(`MCP server ${server.serverId} 超过单条字节预算`);
    }
    /* 复用写入校验，但 keep 不能用；把现值投影成 replace 即可。 */
    const secrets = server.config.transport === "stdio" ? server.config.env : server.config.headers;
    resolveConfig(
      server.config.transport === "stdio"
        ? {
            ...server.config,
            env: Object.entries(secrets).map(([name, value]) => ({ name, action: "replace" as const, value })),
          }
        : {
            ...server.config,
            headers: Object.entries(secrets).map(([name, value]) => ({ name, action: "replace" as const, value })),
          },
      undefined
    );
  }
  if (byteLength(JSON.stringify(state)) > MAX_FILE_BYTES) {
    throw new Error("MCP server 配置超过总字节预算");
  }
}

function projectServer(server: StoredServer): ManualMcpServerView {
  const base = {
    serverId: server.serverId as `manual:${string}`,
    source: "manual" as const,
    displayName: server.displayName,
    enabled: server.enabled,
    eligibility: eligibilityOf(server),
    configDigest: digest(server.config),
    health: {
      state: "unobserved" as const,
      revision: 0,
      detail: "尚无协议层成功或失败证据",
    },
  };
  if (server.config.transport === "stdio") {
    return {
      ...base,
      transport: "stdio",
      command: server.config.command,
      args: [...server.config.args],
      env: maskedSecrets(server.config.env),
    };
  }
  return {
    ...base,
    transport: server.config.transport,
    url: server.config.url,
    headers: maskedSecrets(server.config.headers),
  };
}

function maskedSecrets(values: Record<string, string>) {
  return Object.keys(values)
    .sort()
    .map((name) => ({ name, hasValue: true as const, maskedValue: MASKED }));
}

function eligibilityOf(server: StoredServer): ManualMcpEligibility {
  if (server.config.transport === "stdio") return "eligible";
  if (Object.keys(server.config.headers).length) return "authenticated-remote-unsupported";
  if (new URL(server.config.url).search) return "query-remote-unsupported";
  return "remote-policy-unsupported";
}

function slug(value: string) {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "server"
  );
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)])
  );
}
