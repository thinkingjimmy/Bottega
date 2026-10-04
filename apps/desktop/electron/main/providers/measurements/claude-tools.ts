/**
 * [INPUT]: Depends on inspectAcpSession, the Claude adapter launch (entry, environment), its session-id validation (turn-config), the interactive session meta the product sends, and the request sink and scripted endpoint.
 * [OUTPUT]: Provides probeClaudeToolSet: through the real claude-agent-acp → claude launch, asks session/new for a built-in tool allowlist and the CLI's raw system/init, sends one prompt whose request can only reach Bottega's sink, and returns the built-in tools the CLI announced; claudeToolVerdicts turns that into tool-filter and read-only records. probeClaudeNetworkOff runs the product's interactive session (the path a workflow turn takes) twice against the scripted endpoint, offline and online, each running one curl to a `.invalid` host; claudeNetworkVerdict reads the sandbox proxy's own answer (N5).
 * [POS]: The Claude half of providers/measurements (P4–P8, N5–N6). No model is called, no quota is spent and nothing leaves the machine; the answer comes from the CLI and its sandbox, never from the model or from Bottega's own request.
 */
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectAcpSession } from "../../backends/acp/probe";
import { adapterLaunch } from "../../runtime";
import { claudeAdapterEnvironment } from "../claude/environment";
import { claudeInteractiveSessionMeta } from "../claude/index";
import { claudeSessionMissing, validateClaudeSessionId } from "../claude/turn-config";
import type { ResolvedRuntime } from "../../backends/types";
import { openRequestSink, openScriptedEndpoint } from "./sink";

/* Built-ins that can change the workspace or run code. An unknown name also counts as able to write (P8). */
/* Both probes here run the Claude CLI, with its own session checks. */
const BACKEND = "claude" as const;
const READ_ONLY_BUILTINS = new Set(["Read", "Glob", "Grep", "LS", "TodoWrite", "ExitPlanMode"]);
export type ToolSetResult = { announced: string[] | null; sink: { accepted: number; bytesRead: number }; error: string | null };

export async function probeClaudeToolSet(input: { runtime: ResolvedRuntime; workspace: string; requested: readonly string[]; signal?: AbortSignal;
  inspect?: typeof inspectAcpSession }): Promise<ToolSetResult> {
  const sink = await openRequestSink();
  let announced: string[] | null = null, error: string | null = null;
  try {
    await (input.inspect ?? inspectAcpSession)({
      backend: BACKEND, cwd: input.workspace, signal: input.signal,
      ...adapterLaunch("claude-agent-acp", { ...claudeAdapterEnvironment(input.runtime),
        /* The request goes to Bottega's own sink and fails at once: no retries, no quota (P4/P5). */
        ANTHROPIC_BASE_URL: sink.url, CLAUDE_CODE_MAX_RETRIES: "0", API_TIMEOUT_MS: "5000" }),
      validateSessionId: validateClaudeSessionId, sessionMissing: claudeSessionMissing, timeoutMs: 20_000, totalTimeoutMs: 45_000,
      sessionMeta: { claudeCode: { options: { tools: [...input.requested] }, emitRawSDKMessages: [{ type: "system", subtype: "init" }] } },
      onNotification: (method, params) => {
        const message = (params as { message?: { type?: unknown; subtype?: unknown; tools?: unknown } } | null)?.message;
        if (method === "_claude/sdkMessage" && message?.type === "system" && message.subtype === "init" && Array.isArray(message.tools)) {
          announced = message.tools.filter((tool): tool is string => typeof tool === "string");
        }
      },
    }, async ({ sessionId, request }) => {
      /* The prompt fails against the sink; only the init event before it matters. */
      await request("session/prompt", { sessionId, prompt: [{ type: "text", text: "probe" }] }).catch(() => undefined);
    });
  } catch (cause) {
    error = cause instanceof Error ? cause.message.slice(0, 300) : String(cause);
  } finally {
    await sink.close();
  }
  return { announced, sink: sink.stats(), error };
}

/** tool-filter: the announced built-ins are exactly the requested ones; read-only: none of them can write (P7, P8). */
export function claudeToolVerdicts(requested: readonly string[], result: ToolSetResult) {
  if (!result.announced) return { toolFilter: "unverified" as const, readOnly: "unverified" as const };
  const builtins = result.announced.filter(tool => !tool.startsWith("mcp__"));
  const exact = builtins.length === requested.length && requested.every(tool => builtins.includes(tool));
  return { toolFilter: exact ? "enforced" as const : "unsupported" as const,
    readOnly: exact && builtins.every(tool => READ_ONLY_BUILTINS.has(tool)) ? "enforced" as const : "unverified" as const };
}

/* RFC 6761: `.invalid` never resolves, so the online control's proxy fails upstream (502) without anything leaving the machine,
   while an offline proxy refuses by its allowlist (403) before trying. The model's own traffic goes to the scripted endpoint. */
const UNREACHABLE = "https://bottega-probe.invalid/";
type ConnectCode = string | null;

async function networkRun(input: { runtime: ResolvedRuntime; root: string; offline: boolean; signal?: AbortSignal; inspect?: typeof inspectAcpSession }) {
  const workspace = join(input.root, input.offline ? "offline" : "online"), controlRoot = join(input.root, `${input.offline ? "offline" : "online"}-control`, "ledger");
  await mkdir(workspace, { recursive: true }); await mkdir(controlRoot, { recursive: true });
  const out = join(workspace, "connect.txt");
  const endpoint = await openScriptedEndpoint(`/usr/bin/curl -s -m 8 -o /dev/null -w '%{http_connect}' ${UNREACHABLE} > '${out.replaceAll("'", "'\\''")}'`);
  try {
    await (input.inspect ?? inspectAcpSession)({
      backend: BACKEND, cwd: workspace, signal: input.signal,
      ...adapterLaunch("claude-agent-acp", { ...claudeAdapterEnvironment(input.runtime),
        /* A dummy key to Bottega's own endpoint: the account's credentials are not sent, and none would be read (N6). */
        ANTHROPIC_BASE_URL: endpoint.url, ANTHROPIC_API_KEY: "sk-ant-bottega-probe-not-a-key", ANTHROPIC_AUTH_TOKEN: "",
        CLAUDE_CODE_MAX_RETRIES: "0", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }),
      validateSessionId: validateClaudeSessionId, sessionMissing: claudeSessionMissing, timeoutMs: 40_000, totalTimeoutMs: 75_000,
      /* The exact settings a workflow turn is created with; approve-for-me runs the sandboxed Bash without a prompt nobody answers. */
      sessionMeta: claudeInteractiveSessionMeta({ filesystemAccess: { workspace, readOnlyRoots: [], controlRoot, ...(input.offline ? { network: "off" as const } : {}) },
        payload: { turnOptions: { permissionMode: "approve-for-me" } } }),
    }, async ({ sessionId, request }) => { await request("session/prompt", { sessionId, prompt: [{ type: "text", text: "probe" }] }); });
  } catch { /* a failed session leaves no answer, which reads as unverified */ } finally {
    await endpoint.close();
  }
  return readFile(out, "utf8").then(text => text.trim() || null, () => null);
}

export async function probeClaudeNetworkOff(input: { runtime: ResolvedRuntime; root: string; signal?: AbortSignal; inspect?: typeof inspectAcpSession }) {
  const offline = await networkRun({ ...input, offline: true });
  const control = await networkRun({ ...input, offline: false });
  return { offline, control };
}

/** N5: enforced only as the proxy's own refusal, against a control whose proxy let the same request through to its (failing) upstream. */
export function claudeNetworkVerdict(result: { offline: ConnectCode; control: ConnectCode }) {
  if (result.control !== "502") return "unverified" as const;
  if (result.offline === "403") return "enforced" as const;
  return result.offline === "502" ? "unsupported" as const : "unverified" as const;
}
