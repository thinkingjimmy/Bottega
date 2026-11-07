/**
 * [INPUT]: Depends on the low-level MCP Server/stdio SDK, frozen lease snapshots, invocation identity/digest, private bridge, bounded result/error adapters and main error vocabulary
 * [OUTPUT]: Provides frozen lease-only discovery, one-use persistent claims, invocation identity and cancellation; preserves protocol refusals and returns bounded tool execution errors without exposing private origin metadata
 * [POS]: The MCP-facing subprocess boundary; performs protocol adaptation only, never reads app storage directly, and forwards every call through bridge.ts
 */

import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ToolSnapshot } from "./registry";
import { errorMessage, statusError } from "../ipc/errors";
import { toolInvocationId, toolRequestDigest } from "./invocation";
import { toBuiltinCallToolError, toBuiltinCallToolResult } from "./result";

const socketPath = process.env.AI_CHAT_TOOLS_SOCKET;
const token = process.env.AI_CHAT_TOOLS_TOKEN;
const wireCap = Number(process.env.AI_CHAT_TOOLS_WIRE_CAP);
if (!socketPath || !token || !Number.isSafeInteger(wireCap) || wireCap <= 0) {
  throw new Error("Plugin MCP requires socket, token and wire budget");
}
const bridgeSocketPath = socketPath;
/* One MCP session = one server process; minted before any request so every call of the session shares it. */
const sessionNonce = randomUUID();
const bridgeToken = token;
type BridgeResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; status: number; error: string; errorKind: "protocol" | "tool" };

/*
 * One persistent connection for the life of this process. The token from the environment is a single-use
 * claim: it is presented once, and from then on the connection itself is what main trusts. A copy of the
 * token read by the Agent's shell (printenv, ps) is refused on any other connection, so it cannot be replayed.
 */
const waiting = new Map<string, { resolve(value: unknown): void; reject(cause: unknown): void }>();
let connection: Socket | null = null;
let connectionFailure: Error | null = null;

function bridge() {
  if (connectionFailure) throw connectionFailure;
  if (connection) return connection;
  const socket = createConnection(bridgeSocketPath);
  connection = socket;
  socket.setEncoding("utf8");
  let pending = "";
  socket.on("data", (chunk: string) => {
    pending += chunk;
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
      let response: BridgeResponse;
      try { response = JSON.parse(line) as BridgeResponse; } catch { continue; }
      const waiter = waiting.get(response.id);
      if (!waiter) continue;
      waiting.delete(response.id);
      if (response.ok) waiter.resolve(response.result);
      else waiter.reject(statusError(response.status, response.error, response.errorKind === "tool" ? { toolExecutionError: true } : {}));
    }
  });
  const lost = (cause?: Error) => {
    /* The claim is spent: a new connection could never be trusted again, so this process's tools end here. */
    connectionFailure = cause ?? new Error("内置 MCP bridge 连接已断开");
    for (const waiter of waiting.values()) waiter.reject(connectionFailure);
    waiting.clear();
  };
  socket.once("error", lost);
  socket.once("close", () => lost());
  return socket;
}

function bridgeRequest(
  request:
    | { kind: "claim" }
    | {
        kind: "call";
        tool: string;
        args: unknown;
        invocationId: string;
        requestDigest: string;
      },
  signal?: AbortSignal
) {
  const id = randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    let socket: Socket;
    try { socket = bridge(); } catch (cause) { reject(cause); return; }
    const abort = () => {
      if (!waiting.delete(id)) return;
      socket.write(`${JSON.stringify({ id, kind: "cancel" })}\n`);
      reject(signal?.reason ?? new DOMException("工具调用已取消", "AbortError"));
    };
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("工具调用已取消", "AbortError"));
      return;
    }
    waiting.set(id, {
      resolve: (value) => { signal?.removeEventListener("abort", abort); resolve(value); },
      reject: (cause) => { signal?.removeEventListener("abort", abort); reject(cause); },
    });
    signal?.addEventListener("abort", abort, { once: true });
    socket.write(`${JSON.stringify({ id, token: bridgeToken, ...request })}\n`);
  });
}

function call(tool: string, args: unknown, extra: { requestId: string | number; signal?: AbortSignal }) {
  return bridgeRequest({
    kind: "call",
    tool,
    args,
    invocationId: toolInvocationId(sessionNonce, extra.requestId, tool),
    requestDigest: toolRequestDigest(tool, args),
  }, extra.signal).then((value) => {
    try { return toBuiltinCallToolResult(value, wireCap, tool); }
    catch (cause) { return toBuiltinCallToolError(errorMessage(cause), wireCap); }
  }, (cause: unknown) => {
    if (!cause || typeof cause !== "object" || !("toolExecutionError" in cause) || cause.toolExecutionError !== true) throw cause;
    return toBuiltinCallToolError(errorMessage(cause), wireCap);
  });
}

const server = new Server({ name: "bottega", version: "1.0.0" }, { capabilities: { tools: {} } });

void (async () => {
  const claim = await bridgeRequest({ kind: "claim" }) as { tools: ToolSnapshot[] };
  const frozen = Object.freeze(claim.tools);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: frozen.map(tool => ({
    name: tool.name, description: tool.description, inputSchema: tool.inputSchema as { type: "object"; [key: string]: unknown }, annotations: tool.annotations,
  })) }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (!frozen.some(tool => tool.name === request.params.name)) throw statusError(403, "Tool was not issued for this turn");
    return call(request.params.name, request.params.arguments ?? {}, extra);
  });
  await server.connect(new StdioServerTransport());
})().catch(cause => {
  console.error("[plugin-mcp] startup failed", cause);
  process.exitCode = 1;
  connection?.destroy();
});

/* The CLI owns this process: once its end of stdin is gone nobody can call a tool, and the persistent bridge
   connection would otherwise keep this process alive, orphaned, for as long as main runs. */
let ending = false;
const exitWithCli = () => {
  if (ending) return;
  ending = true;
  connection?.destroy();
  void server.close().catch(() => undefined).finally(() => process.exit());
};
process.stdin.once("end", exitWithCli);
process.stdin.once("close", exitWithCli);
