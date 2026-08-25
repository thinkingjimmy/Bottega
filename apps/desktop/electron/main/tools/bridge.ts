/**
 * [INPUT]: Depends on Node Unix socket, shared tool name, BuiltinMcpLeaseStore and BuiltinToolRegistry
 * [OUTPUT]: Provides restartable 0600 native bridge, execute token/allowedTools, domain frequency control, socket-close/lease-revoke, cancel, ready, reverse, strict distribution and audit
 * [POS]: The process boundaries of tools; The stdio subprocess does not contact the product store, and can only be called via this bridge for static registration capabilities
 */

import { chmod, mkdir, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { z } from "zod";
import {
  BUILTIN_TOOL_NAMES,
  type BuiltinToolName,
} from "../../../shared/builtin-tools";
import type { BuiltinMcpLeaseStore } from "./lease";
import type { BuiltinToolRegistry } from "./registry";

const REQUEST_LIMIT = 1024 * 1024;

const readyRequestSchema = z
  .object({
    id: z.string().min(1).max(128),
    token: z.string().length(64),
    kind: z.literal("ready"),
  })
  .strict();
const callRequestSchema = z
  .object({
    id: z.string().min(1).max(128),
    token: z.string().length(64),
    kind: z.literal("call"),
    tool: z.enum(BUILTIN_TOOL_NAMES as [BuiltinToolName, ...BuiltinToolName[]]),
    args: z.unknown(),
    invocationId: z.string().min(1).max(128),
  })
  .strict();
const requestSchema = z.union([readyRequestSchema, callRequestSchema]);

type BridgeResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; status: number; error: string };

export class BuiltinMcpBridge {
  private server: Server | null = null;
  private accepting = false;

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

  stopAdmission() {
    this.accepting = false;
    this.leases.revokeAll();
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
    let completed = false;
    const controller = new AbortController();
    socket.once("close", () => {
      if (!completed) controller.abort(new Error("内置 MCP 调用方已断开"));
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
        if (line.trim()) {
          void this.respond(socket, line, controller.signal).finally(() => {
            completed = true;
          });
        }
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
    callSignal: AbortSignal
  ) {
    let requestId = "invalid";
    let response: BridgeResponse;
    try {
      const request = requestSchema.parse(JSON.parse(line));
      requestId = request.id;
      if (!this.accepting) throw statusError(503, "内置 MCP 正在关闭");
      if (request.kind === "ready") {
        if (!this.leases.markReady(request.token)) {
          throw statusError(401, "内置 MCP lease 无效或已撤销");
        }
        response = { id: request.id, ok: true, result: { ready: true } };
      } else {
        const lease = this.leases.authorize(request.token, request.tool);
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
            signal: AbortSignal.any([callSignal, lease.signal]),
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
    if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
  }
}

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
