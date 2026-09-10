/**
 * [INPUT]: Depends on the locked Claude SDK, registered executable policy and supervised control-only transport.
 * [OUTPUT]: Performs one experimental usage query with empty input, MCP, tools, plugins and settings sources.
 * [POS]: Claude quota adapter; SDK initialization cannot submit a model prompt through this transport.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { claudeAdapterEnvironment } from "../../backends/claude/environment";
import { createSupervisedSession, type SupervisedSession } from "../../backends/supervised-session";
import { normalizeClaude } from "../normalization";
import { inQuotaWorkspace, QuotaReadError, type QuotaReader } from "./common";
import { guardClaudeControlInput } from "./protocol";
export const readClaudeQuota: QuotaReader = (runtime, signal) => inQuotaWorkspace(async (cwd) => {
  let release!: () => void;
  const done = new Promise<void>((resolve) => { release = resolve; });
  // eslint-disable-next-line require-yield -- The SDK requires a stream; quota reads must never yield a model message.
  async function* input(): AsyncGenerator<never> { await done; }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  let session: SupervisedSession | undefined;
  let operation: ReturnType<typeof query> | undefined;
  try {
    signal.throwIfAborted();
    operation = query({ prompt: input(), options: {
    pathToClaudeCodeExecutable: runtime.executable, cwd, env: claudeAdapterEnvironment(runtime), abortController: controller,
    persistSession: false, tools: [], mcpServers: {}, strictMcpConfig: true, settingSources: [],
    permissionMode: "dontAsk", plugins: [], settings: { disableAllHooks: true, autoMemoryEnabled: false },
    extraArgs: { "safe-mode": null, "no-chrome": null }, stderr: () => undefined,
    spawnClaudeCodeProcess: (options) => {
      if (session || options.command !== runtime.executable) throw new QuotaReadError("unsupported");
      session = createSupervisedSession({ backend: "claude", command: options.command, args: options.args,
        env: options.env, cwd, signal });
      guardClaudeControlInput(session.child);
      return session.child;
    },
  } });
    const result = operation.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
    if (!session) throw new QuotaReadError("startup-unavailable");
    return normalizeClaude(await session.race(result), Date.now());
  } finally {
    signal.removeEventListener("abort", abort);
    release();
    operation?.close();
    await session?.close();
  }
});
