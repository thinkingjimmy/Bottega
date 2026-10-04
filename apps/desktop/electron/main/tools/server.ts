/**
 * [INPUT]: Depends on MCP SDK stdio transport, shared static tools, specification/condition description, invocation identity/digest helpers and main Unix socket, and statusError from main/errors
 * [OUTPUT]: Provides the standalone MCP stdio process: registers only the lease-allowed builtin tools, claims its lease once on one persistent Unix-socket connection (the token from the environment is single use) and forwards each call and cancel on it with an identity of (session nonce, JSON-RPC request id, tool) plus a content digest, and exits when its CLI's stdin ends; tools/list descriptions carry all model-facing semantics
 * [POS]: The MCP-facing subprocess boundary; performs protocol adaptation only, never reads app storage directly, and forwards every call through bridge.ts
 */

import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  BUILTIN_TOOL_NAMES,
  BUILTIN_TOOL_SPECS,
  builtinToolDescription,
  builtinToolWireSchema,
  type BuiltinToolName,
} from "../../../shared/builtin-tools";
import { statusError } from "../ipc/errors";
import { toolInvocationId, toolRequestDigest } from "./invocation";
import { toBuiltinCallToolResult } from "./result";

const socketPath = process.env.AI_CHAT_TOOLS_SOCKET;
const token = process.env.AI_CHAT_TOOLS_TOKEN;
const allowedRaw = process.env.AI_CHAT_TOOLS_ALLOWED;
const wireCap = Number(process.env.AI_CHAT_TOOLS_WIRE_CAP);
if (
  !socketPath ||
  !token ||
  allowedRaw === undefined ||
  !Number.isSafeInteger(wireCap) ||
  wireCap <= 0
) {
  throw new Error("内置 MCP 缺少 socket/token/allowed/wire cap 环境");
}
const bridgeSocketPath = socketPath;
/* One MCP session = one server process; minted before any request so every call of the session shares it. */
const sessionNonce = randomUUID();
const bridgeToken = token;
const allowed = new Set(
  allowedRaw
    .split(",")
    .filter((name): name is BuiltinToolName =>
      BUILTIN_TOOL_NAMES.includes(name as BuiltinToolName)
    )
);

type BridgeResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; status: number; error: string };

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
      else waiter.reject(statusError(response.status, response.error));
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
        tool: BuiltinToolName;
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

function call(tool: BuiltinToolName, args: unknown, extra: { requestId: string | number; signal?: AbortSignal }) {
  return bridgeRequest({
    kind: "call",
    tool,
    args,
    invocationId: toolInvocationId(sessionNonce, extra.requestId, tool),
    requestDigest: toolRequestDigest(tool, args),
  }, extra.signal).then((value) => toBuiltinCallToolResult(value, wireCap, tool));
}

const server = new McpServer(
  { name: "ai-chat-tools", version: "1.0.0" },
  {
    jsonSchemaValidator: {
      getValidator: () => () => ({
        valid: false,
        data: undefined,
        errorMessage: "内置 MCP 不支持 elicitation",
      }),
    },
  }
);

for (const spec of BUILTIN_TOOL_SPECS) {
  if (!allowed.has(spec.name)) continue;
  server.registerTool(
    spec.name,
    {
      description: builtinToolDescription(spec, [...allowed]),
      // wire 形态必须无 $ref（Moonshot 400）；强校验在 main bridge，不在此
      inputSchema: builtinToolWireSchema(spec).shape,
      annotations: spec.annotations,
    },
    (args: Record<string, unknown>, extra) =>
      call(spec.name, args, extra)
  );
}

server.server.oninitialized = () => {
  void bridgeRequest({ kind: "claim" }).catch((cause) => {
    console.error("[builtin-mcp] ready failed", cause);
    process.exitCode = 1;
    void server.close();
  });
};

void server.connect(new StdioServerTransport()).catch((cause) => {
  console.error("[builtin-mcp] startup failed", cause);
  process.exitCode = 1;
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
