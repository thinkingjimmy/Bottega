/**
 * [INPUT]: Depends on the production of four non-Electron side effects ACP launcher/session validator, shared inspection AcpSession, packing Electron Run-As-Node with a temporary hermetic runtime wrapper
 * [OUTPUT]: For dist smoke, the default is to provide a fail-closed 0 prompt four launcher initialize→session/new→cleanup; fixture runtime is only for fixed ACP/Codex app-server protocols
 * [POS]: The main distribution package is a unified private entry; No real accounts, no prompt, no external command/args input
 */

import { appendFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import {
  AGENT_BACKEND_ORDER,
  type AgentBackendId,
} from "../../shared/agent-ipc";
import { inspectAcpSession } from "./backends/acp/probe";
import type { AcpLaunch, ResolvedRuntime } from "./backends/types";
import {
  codexAcpLaunch,
  validateCodexSessionId,
} from "./backends/codex/adapter-entry";
import {
  claudeAcpLaunch,
  validateClaudeSessionId,
} from "./backends/claude/environment";
import {
  kimiAcpLaunch,
  validateKimiSessionId,
} from "./backends/kimi/home";
import {
  opencodeAcpLaunch,
  validateOpencodeSessionId,
} from "./backends/opencode/home";

const GATE = "AI_CHAT_DIST_CONNECTIVITY_SMOKE";
const MODE = "AI_CHAT_DIST_CONNECTIVITY_MODE";
const BACKEND = "AI_CHAT_DIST_CONNECTIVITY_BACKEND";
const TRACE = "AI_CHAT_DIST_CONNECTIVITY_TRACE";
const FIXTURE_MODE = "fixture-runtime";
const UUID = "123e4567-e89b-42d3-a456-426614174000";

const SESSION_IDS: Record<AgentBackendId, string> = {
  codex: UUID,
  claude: "claude-dist-smoke",
  kimi: "kimi-dist-smoke",
  opencode: "ses_0123456789ABCDEFGHIJKLMNOQ",
};

const sessionValidators: Record<AgentBackendId, (id: string) => boolean> = {
  codex: validateCodexSessionId,
  claude: validateClaudeSessionId,
  kimi: validateKimiSessionId,
  opencode: validateOpencodeSessionId,
};

function failClosed() {
  if (process.env[GATE] !== "1") {
    throw new Error(`${GATE}=1 才能运行发行包联通性 smoke`);
  }
}

function fixtureBackend() {
  const backend = process.env[BACKEND];
  if (!AGENT_BACKEND_ORDER.includes(backend as AgentBackendId)) {
    throw new Error("fixture backend 不在固定四家枚举中");
  }
  return backend as AgentBackendId;
}

function send(id: unknown, result: unknown) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function sendClaudeResponse(
  requestId: string,
  response: Record<string, unknown>
) {
  process.stdout.write(
    `${JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response,
      },
    })}\n`
  );
}

function claudeControlResponse(subtype: string) {
  if (subtype === "initialize") {
    return {
      commands: [],
      agents: [],
      output_style: "default",
      available_output_styles: [],
      models: [
        {
          value: "claude-smoke",
          displayName: "Claude Smoke",
          description: "Hermetic dist smoke model",
          supportsEffort: false,
          supportsAdaptiveThinking: false,
          supportsFastMode: false,
          supportsAutoMode: false,
        },
      ],
      account: { apiProvider: "firstParty" },
    };
  }
  return subtype === "interrupt" ? { still_queued: [] } : {};
}

function traceFixture(backend: AgentBackendId, event: string) {
  const file = process.env[TRACE];
  if (!file) return;
  try {
    appendFileSync(file, `${backend}:${event}\n`, { encoding: "utf8" });
  } catch {
    // trace 只是失败证据，不改变被测协议。
  }
}

function codexResult(method: string) {
  const model = {
    id: "gpt-smoke",
    model: "gpt-smoke",
    displayName: "GPT Smoke",
    description: "Hermetic dist smoke model",
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Low" },
    ],
    isDefault: true,
    inputModalities: ["text"],
    supportsPersonality: false,
  };
  const results: Record<string, unknown> = {
    initialize: { codexHome: "/tmp/ai-chat-dist-smoke" },
    "skills/extraRoots/set": {},
    "skills/list": { data: [] },
    "thread/start": {
      thread: { id: UUID, preview: "", ephemeral: false },
      model: model.id,
      reasoningEffort: "low",
      modelProvider: "openai",
      serviceTier: null,
    },
    "model/list": { data: [model], nextCursor: null },
    "account/read": {
      account: { type: "chatgpt", email: "smoke@example.invalid" },
      requiresOpenaiAuth: false,
    },
    "thread/archive": {},
    "thread/unsubscribe": {},
  };
  return results[method] ?? {};
}

function acpResult(backend: AgentBackendId, method: string) {
  if (method === "initialize") {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: `${backend}-dist-fixture`, version: "1.0.0" },
      agentCapabilities: { sessionCapabilities: { delete: {} } },
    };
  }
  if (method === "session/new") return { sessionId: SESSION_IDS[backend] };
  return {};
}

function runFixtureRuntime(backend: AgentBackendId) {
  traceFixture(backend, "started");
  const codexAppServer =
    backend === "codex" && process.argv.slice(3).includes("app-server");
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    let request: {
      id?: unknown;
      method?: unknown;
      type?: unknown;
      request_id?: unknown;
      request?: { subtype?: unknown };
    };
    try {
      request = JSON.parse(line);
    } catch {
      traceFixture(backend, "invalid-json");
      return;
    }
    if (
      backend === "claude" &&
      request.type === "control_request" &&
      typeof request.request_id === "string" &&
      typeof request.request?.subtype === "string"
    ) {
      traceFixture(backend, `control-${request.request.subtype}`);
      sendClaudeResponse(
        request.request_id,
        claudeControlResponse(request.request.subtype)
      );
      return;
    }
    if (request.id === undefined || typeof request.method !== "string") return;
    traceFixture(backend, `jsonrpc-${request.method}`);
    send(
      request.id,
      codexAppServer
        ? codexResult(request.method)
        : acpResult(backend, request.method)
    );
  });
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function createRuntimeWrapper(
  root: string,
  entry: string,
  backend: AgentBackendId
) {
  const wrapper = join(root, `fixture-agent-${backend}`);
  await writeFile(
    wrapper,
    [
      "#!/bin/sh",
      `export ${GATE}=1`,
      `export ${MODE}=${FIXTURE_MODE}`,
      `export ${BACKEND}=${backend}`,
      `export ${TRACE}=${shellQuote(join(root, "fixture-trace.log"))}`,
      "export ELECTRON_RUN_AS_NODE=1",
      `exec ${shellQuote(process.execPath)} ${shellQuote(entry)} --fixture-runtime "$@"`,
      "",
    ].join("\n"),
    { mode: 0o700 }
  );
  await chmod(wrapper, 0o700);
  return wrapper;
}

function launchFor(
  backend: AgentBackendId,
  runtime: ResolvedRuntime,
  env: NodeJS.ProcessEnv
): AcpLaunch {
  const launchers = {
    codex: () => codexAcpLaunch(runtime, { processEnv: env }),
    claude: () => claudeAcpLaunch(runtime, { processEnv: env }),
    kimi: () => kimiAcpLaunch(runtime, { processEnv: env }),
    opencode: () =>
      opencodeAcpLaunch(runtime, {
        processEnv: env,
        session: { approveForMe: false, planMode: false },
      }),
  } satisfies Record<AgentBackendId, () => AcpLaunch>;
  return launchers[backend]();
}

async function runSmoke() {
  if (process.argv.length !== 2) {
    throw new Error("发行包联通性入口不接受参数");
  }
  const entry = process.argv[1];
  if (!entry) throw new Error("无法解析当前 smoke entry");
  const root = await mkdtemp(join(tmpdir(), "ai-chat-dist-connectivity-"));
  try {
    const workspace = join(root, "workspace");
    const stateDirectories = {
      HOME: join(root, "home"),
      CODEX_HOME: join(root, "codex-home"),
      CLAUDE_CONFIG_DIR: join(root, "claude-config"),
      KIMI_CODE_HOME: join(root, "kimi-home"),
      KIMI_CODE_CACHE_DIR: join(root, "kimi-cache"),
      XDG_CONFIG_HOME: join(root, "xdg", "config"),
      XDG_DATA_HOME: join(root, "xdg", "data"),
      XDG_CACHE_HOME: join(root, "xdg", "cache"),
      XDG_STATE_HOME: join(root, "xdg", "state"),
      OPENCODE_CONFIG_DIR: join(root, "opencode-config"),
      TMPDIR: join(root, "tmp"),
    };
    await Promise.all(
      [workspace, ...Object.values(stateDirectories)].map((directory) =>
        mkdir(directory, { recursive: true, mode: 0o700 })
      )
    );
    const opencodeConfig = join(
      stateDirectories.OPENCODE_CONFIG_DIR,
      "opencode.json"
    );
    await writeFile(opencodeConfig, "{}\n", { mode: 0o600 });
    const rows: AgentBackendId[] = [];
    for (const backend of AGENT_BACKEND_ORDER) {
      process.stderr.write(`[dist-connectivity] ${backend} launcher\n`);
      const wrapper = await createRuntimeWrapper(root, entry, backend);
      const runtime: ResolvedRuntime = {
        executable: wrapper,
        path: dirname(wrapper),
        version: "999.0.0",
      };
      const fixtureEnv = {
        [GATE]: "1",
        [MODE]: FIXTURE_MODE,
        [BACKEND]: backend,
        ...stateDirectories,
        OPENCODE_CONFIG: opencodeConfig,
        ELECTRON_RUN_AS_NODE: "1",
      };
      const launch = launchFor(backend, runtime, fixtureEnv);
      let sessionId: string;
      try {
        sessionId = await inspectAcpSession(
          {
            backend,
            ...launch,
            cwd: workspace,
            timeoutMs: 15_000,
            validateSessionId: sessionValidators[backend],
          },
          async ({ initialized, request, sessionId: created }) => {
            const protocol = (initialized as { protocolVersion?: unknown })
              ?.protocolVersion;
            if (protocol !== PROTOCOL_VERSION) {
              throw new Error(`${backend} protocol=${String(protocol)}`);
            }
            if (backend === "claude") {
              /* Claude 同时声明 close/delete；零 prompt fixture 没有 transcript，
                 delete 会正确报 not found。先走生产 close，再从本次 probe 的
                 本地 capability 快照移除两项，避免 finally 二次 cleanup。 */
              await request("session/close", { sessionId: created });
              const capabilities = (initialized as {
                agentCapabilities?: {
                  sessionCapabilities?: Record<string, unknown>;
                };
              }).agentCapabilities?.sessionCapabilities;
              if (capabilities) {
                delete capabilities.close;
                delete capabilities.delete;
              }
            }
            return created;
          }
        );
      } catch (cause) {
        const trace = await readFile(join(root, "fixture-trace.log"), "utf8")
          .catch(() => "no-fixture-events");
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `${backend} launcher smoke 失败：${message}；fixtureTrace=${trace.trim()}`,
          { cause }
        );
      }
      if (!sessionValidators[backend](sessionId)) {
        throw new Error(`${backend} sessionId 未通过生产 validator`);
      }
      rows.push(backend);
    }
    process.stdout.write(
      `dist connectivity smoke passed ${rows
        .map((backend) => `${backend}:passed`)
        .join(" ")}\n`
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  failClosed();
  const args = process.argv.slice(2);
  if (args[0] === "--fixture-runtime") {
    if (process.env[MODE] !== FIXTURE_MODE) {
      throw new Error("fixture runtime mode 无效");
    }
    runFixtureRuntime(fixtureBackend());
    return;
  }
  await runSmoke();
}

void main().catch((cause) => {
  process.stderr.write(
    `[dist-connectivity] ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`
  );
  process.exitCode = 1;
});
