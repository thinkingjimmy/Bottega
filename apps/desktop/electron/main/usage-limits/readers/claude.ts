/**
 * [INPUT]: Depends on the locked Claude SDK (loaded on the first quota read, never at module evaluation), registered executable policy and supervised control-only transport.
 * [OUTPUT]: Opens a warm control session whose every read is one experimental usage query with empty input, MCP, tools, plugins and settings sources, plus the one-shot reader over it.
 * [POS]: Claude quota adapter; SDK initialization cannot submit a model prompt through this transport.
 */
import { claudeAdapterEnvironment } from "../../backends/claude/environment";
import { createSupervisedSession, type SupervisedSession } from "../../backends/supervised-session";
import { normalizeClaude } from "../normalization";
import { openQuotaWorkspace, QuotaReadError, readOnce, whenAborted, type QuotaChannelOpener } from "./common";
import { guardClaudeControlInput } from "./protocol";

type ClaudeQuery = (typeof import("@anthropic-ai/claude-agent-sdk"))["query"];

/* The SDK is a 1.3 MB ESM bundle and quota is never read before first paint;
   mirror backends/claude/policy.ts and pay for it only when a quota is asked for. */
let sdkQuery: Promise<ClaudeQuery> | undefined;

function loadSdkQuery() {
  sdkQuery ??= import("@anthropic-ai/claude-agent-sdk")
    .then((sdk) => sdk.query)
    .catch((cause) => { sdkQuery = undefined; throw cause; });
  return sdkQuery;
}

export const openClaudeQuotaChannel: QuotaChannelOpener = async (runtime, signal) => {
  const workspace = await openQuotaWorkspace();
  let release!: () => void;
  const done = new Promise<void>((resolve) => { release = resolve; });
  // eslint-disable-next-line require-yield -- The SDK requires a stream; quota reads must never yield a model message.
  async function* input(): AsyncGenerator<never> { await done; }
  /* The control session, not the read, owns the process: the input stream stays pending so
     the CLI keeps its initialized state, and only close() ends it. */
  const lifetime = new AbortController();
  let session: SupervisedSession | undefined;
  let operation: ReturnType<ClaudeQuery> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    release();
    operation?.close();
    lifetime.abort();
    await session?.close().catch(() => undefined);
    await workspace.release().catch(() => undefined);
  })();
  try {
    signal.throwIfAborted();
    const query = await loadSdkQuery();
    signal.throwIfAborted();
    const active = operation = query({ prompt: input(), options: {
      pathToClaudeCodeExecutable: runtime.executable, cwd: workspace.cwd, env: claudeAdapterEnvironment(runtime), abortController: lifetime,
      persistSession: false, tools: [], mcpServers: {}, strictMcpConfig: true, settingSources: [],
      permissionMode: "dontAsk", plugins: [], settings: { disableAllHooks: true, autoMemoryEnabled: false },
      extraArgs: { "safe-mode": null, "no-chrome": null }, stderr: () => undefined,
      spawnClaudeCodeProcess: (options) => {
        if (session || options.command !== runtime.executable) throw new QuotaReadError("unsupported");
        session = createSupervisedSession({ backend: "claude", command: options.command, args: options.args,
          env: options.env, cwd: workspace.cwd, signal: lifetime.signal });
        guardClaudeControlInput(session.child);
        return session.child;
      },
    } });
    return {
      async read(readSignal: AbortSignal) {
        const result = active.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
        if (!session) throw new QuotaReadError("startup-unavailable");
        return normalizeClaude(await session.race(Promise.race([result, whenAborted(readSignal)])), Date.now());
      },
      close,
    };
  } catch (cause) { await close(); throw cause; }
};

export const readClaudeQuota = readOnce(openClaudeQuotaChannel);
