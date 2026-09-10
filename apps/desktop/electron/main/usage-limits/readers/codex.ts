/**
 * [INPUT]: Depends on the registered Codex runtime, native environment and supervised JSON-RPC.
 * [OUTPUT]: Reads the current account and all quota pools without experimental capabilities or a turn.
 * [POS]: Codex quota adapter; authentication files remain owned by the native CLI.
 */
import { codexEnvironment } from "../../backends/codex/environment";
import { createSupervisedSession } from "../../backends/supervised-session";
import { normalizeCodex, quotaLabel } from "../normalization";
import { inQuotaWorkspace, object, QuotaReadError, type QuotaReader } from "./common";
import { jsonRpc } from "./protocol";
export const readCodexQuota: QuotaReader = (runtime, signal) => inQuotaWorkspace(async (cwd) => {
  const session = createSupervisedSession({ backend: "codex", command: runtime.executable,
    args: ["-c", "analytics.enabled=false", "app-server", "--listen", "stdio://"], cwd, env: codexEnvironment(runtime), signal });
  try {
    const rpc = jsonRpc(session);
    await rpc.request("initialize", { clientInfo: { name: "bottega_usage", version: "1.0.0" } });
    rpc.initialized();
    const result = object(await rpc.request("account/read", { refreshToken: false }));
    if (result.account === null) throw new QuotaReadError("needs-auth");
    const account = object(result.account);
    if (account.type !== "chatgpt") throw new QuotaReadError("unsupported");
    return normalizeCodex(await rpc.request("account/rateLimits/read"), Date.now(), quotaLabel(account.planType));
  } finally { await session.close(); }
});
