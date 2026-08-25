/**
 * [INPUT]: Depends on MCP SDK stdio transport, shared static tools, specification/condition description, invoking hash and main Unix socket
 * [OUTPUT]: The independent process only registers the lease tools and forward calls; Model semantics are taken up in the context of tools/list description and prompt products
 * [POS]: The back end of tools is not connected to the MCP input; Just do the protocol adaptation, don't read the product storage, don't copy content/structuredContent
 */

import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  BUILTIN_TOOL_NAMES,
  BUILTIN_TOOL_SPECS,
  builtinToolDescription,
  builtinToolWireSchema,
  type BuiltinToolName,
} from "../../../shared/builtin-tools";
import { stableToolInvocationId } from "./invocation";
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

function bridgeRequest(
  request:
    | { kind: "ready" }
    | {
        kind: "call";
        tool: BuiltinToolName;
        args: unknown;
        invocationId: string;
      },
  signal?: AbortSignal
) {
  const id = randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    const socket = createConnection(bridgeSocketPath);
    let settled = false;
    const abort = () => {
      const cause =
        signal?.reason ?? new DOMException("工具调用已取消", "AbortError");
      settled = true;
      socket.destroy(cause instanceof Error ? cause : undefined);
      reject(cause);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    socket.setEncoding("utf8");
    let pending = "";
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ id, token: bridgeToken, ...request })}\n`);
    });
    socket.on("data", (chunk: string) => {
      pending += chunk;
      const newline = pending.indexOf("\n");
      if (newline < 0) return;
      socket.end();
      try {
        const response = JSON.parse(pending.slice(0, newline)) as BridgeResponse;
        if (response.id !== id) throw new Error("内置 MCP bridge 响应串线");
        if (!response.ok) {
          throw Object.assign(new Error(response.error), {
            status: response.status,
          });
        }
        signal?.removeEventListener("abort", abort);
        settled = true;
        socket.end();
        resolve(response.result);
      } catch (cause) {
        signal?.removeEventListener("abort", abort);
        settled = true;
        socket.destroy();
        reject(cause);
      }
    });
    socket.once("error", (cause) => {
      signal?.removeEventListener("abort", abort);
      settled = true;
      reject(cause);
    });
    socket.once("close", () => {
      if (!settled) reject(new Error("内置 MCP bridge 未返回响应"));
    });
  });
}

function call(tool: BuiltinToolName, args: unknown, signal?: AbortSignal) {
  return bridgeRequest({
    kind: "call",
    tool,
    args,
    invocationId: stableToolInvocationId(tool, args),
  }, signal).then((value) => toBuiltinCallToolResult(value, wireCap, tool));
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
      call(spec.name, args, extra.signal)
  );
}

server.server.oninitialized = () => {
  void bridgeRequest({ kind: "ready" }).catch((cause) => {
    console.error("[builtin-mcp] ready failed", cause);
    process.exitCode = 1;
    void server.close();
  });
};

void server.connect(new StdioServerTransport()).catch((cause) => {
  console.error("[builtin-mcp] startup failed", cause);
  process.exitCode = 1;
});
