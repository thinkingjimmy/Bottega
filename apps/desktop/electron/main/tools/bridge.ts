/**
 * [INPUT]: Depends on Node Unix socket, shared tool name, BuiltinMcpLeaseStore and BuiltinToolRegistry, and statusError from main/errors
 * [OUTPUT]: Provides restartable 0600 native bridge where the MCP server claims its lease once on a persistent connection and every call and cancel travels on that connection (a replayed token on any other connection is refused), execute token/allowedTools, same-identity-different-content refusal, domain frequency control, socket-close/lease-revoke, claimed connections destroyed on stop-admission and close (so close never waits on them), cancel, ready, reverse, strict distribution and audit
 * [POS]: The tools process boundary; the stdio subprocess never touches app storage and can only invoke statically registered builtin tools through this bridge
 */

import { chmod, mkdir, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { z } from "zod";
import {
  BUILTIN_TOOL_NAMES,
  type BuiltinToolName,
} from "../../../shared/builtin-tools";
import { statusError } from "../ipc/errors";
import type { BuiltinMcpLeaseStore } from "./lease";
import type { BuiltinToolRegistry } from "./registry";

const REQUEST_LIMIT = 1024 * 1024;

const claimRequestSchema = z
  .object({
    id: z.string().min(1).max(128),
    token: z.string().length(64),
    kind: z.literal("claim"),
  })
  .strict();
const cancelRequestSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.literal("cancel"),
  })
  .strict();
const callRequestSchema = z
  .object({
    id: z.string().min(1).max(128),
    token: z.string().length(64),
    kind: z.literal("call"),
    tool: z.enum(BUILTIN_TOOL_NAMES as [BuiltinToolName, ...BuiltinToolName[]]),
    args: z.unknown(),
    invocationId: z.string().regex(/^[a-f0-9]{64}$/),
    requestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
const requestSchema = z.union([claimRequestSchema, callRequestSchema, cancelRequestSchema]);

type BridgeResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; status: number; error: string };

export class BuiltinMcpBridge {
  private server: Server | null = null;
  private accepting = false;
  /* Claimed connections live as long as their MCP server; nothing ends them from the other side at shutdown. */
  private readonly sockets = new Set<Socket>();

  constructor(
    readonly socketPath: string,
    private readonly leases: BuiltinMcpLeaseStore,
    private readonly registry: BuiltinToolRegistry
  ) {}

  async start() {
    if (this.server) return;
    await mkdir(dirname(this.socketPath), { recursive: true, mode: 0o700 });
    await unlink(this.socketPath).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== "ENOENT") throw cause;
    });
    const server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    await chmod(this.socketPath, 0o600);
    this.server = server;
    this.accepting = true;
  }

  /* A revoked lease can never be claimed again, so its connection is only a way for server.close() to hang and for
     a call in flight to outlive shutdown: both end here. */
  stopAdmission() {
    this.accepting = false;
    this.leases.revokeAll();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  async reopenAdmission() {
    if (!this.server) await this.start();
    this.accepting = true;
  }

  async close() {
    this.stopAdmission();
    const server = this.server;
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server.close((cause) => (cause ? reject(cause) : resolve()))
      );
      if (this.server === server) this.server = null;
    }
    await unlink(this.socketPath).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== "ENOENT") throw cause;
    });
  }

  private accept(socket: Socket) {
    socket.setEncoding("utf8");
    let pending = "";
    /* The connection is the credential once claimed: a symbol no other socket can present. */
    const connection = Symbol("builtin-mcp-connection");
    const calls = new Map<string, AbortController>();
    this.sockets.add(socket);
    socket.once("close", () => {
      this.sockets.delete(socket);
      for (const controller of calls.values()) controller.abort(new Error("内置 MCP 调用方已断开"));
      calls.clear();
    });
    socket.on("data", (chunk: string) => {
      pending += chunk;
      if (Buffer.byteLength(pending, "utf8") > REQUEST_LIMIT) {
        socket.destroy(new Error("内置 MCP bridge 请求过大"));
        return;
      }
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.trim()) void this.respond(socket, line, connection, calls);
        newline = pending.indexOf("\n");
      }
    });
    socket.on("error", (cause) =>
      console.warn("[builtin-mcp] socket closed", cause.message)
    );
  }

  private async respond(
    socket: Socket,
    line: string,
    connection: symbol,
    calls: Map<string, AbortController>
  ) {
    let requestId = "invalid";
    let response: BridgeResponse;
    const controller = new AbortController();
    try {
      const request = requestSchema.parse(JSON.parse(line));
      requestId = request.id;
      /* A cancel names a call in flight on this connection; it has no answer of its own. */
      if (request.kind === "cancel") { calls.get(request.id)?.abort(new Error("工具调用已取消")); return; }
      if (!this.accepting) throw statusError(503, "内置 MCP 正在关闭");
      if (request.kind === "claim") {
        if (!this.leases.claim(request.token, connection)) {
          throw statusError(401, "内置 MCP lease 无效或已撤销");
        }
        response = { id: request.id, ok: true, result: { ready: true } };
      } else {
        if (calls.has(request.id)) throw statusError(409, "内置 MCP 调用 id 重复");
        calls.set(request.id, controller);
        const lease = this.leases.authorize(request.token, request.tool, connection);
        this.leases.claimInvocation(lease, request.invocationId, request.requestDigest);
        this.leases.consume(request.token, request.tool);
        console.info(
          `[builtin-mcp] request=${lease.requestId} generation=${lease.generation} tool=${request.tool} argsBytes=${Buffer.byteLength(JSON.stringify(request.args ?? {}), "utf8")}`
        );
        response = {
          id: request.id,
          ok: true,
          result: await this.registry.call(request.tool, request.args, {
            lease,
            invocationId: request.invocationId,
            signal: AbortSignal.any([controller.signal, lease.signal]),
          }),
        };
      }
    } catch (cause) {
      const value = cause as { status?: unknown; message?: unknown };
      response = {
        id: requestId,
        ok: false,
        status: typeof value?.status === "number" ? value.status : 500,
        error:
          typeof value?.message === "string" ? value.message : String(cause),
      };
    }
    if (calls.get(requestId) === controller) calls.delete(requestId);
    if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
  }
}

