/**
 * [INPUT]: Depends on the Kimi runtime, disposable query home, Seatbelt and a supervised loopback server.
 * [OUTPUT]: Reads the managed account quota once; startup bearer bytes never enter diagnostics.
 * [POS]: Kimi quota adapter; native locks and credential persistence remain intact.
 */
import { StringDecoder } from "node:string_decoder";
import { join } from "node:path";
import { kimiEnvironment } from "../../backends/kimi/home";
import { wrapInteractiveWithSeatbelt } from "../../backends/sandbox/seatbelt";
import { createSupervisedSession } from "../../backends/supervised-session";
import { normalizeKimi } from "../normalization";
import { createQuotaKimiHome } from "./kimi-home";
import { boundedJson, inQuotaWorkspace, object, QuotaReadError, type QuotaReader } from "./common";

export function kimiStartupParser(ready: (value: { base: string; authorization: string }) => void) {
  const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
  const fragments = { stdout: "", stderr: "" };
  let base: string | undefined;
  let token: string | undefined;
  let completed = false;
  return (chunk: Buffer, stream: "stdout" | "stderr") => {
    if (completed) return;
    fragments[stream] += decoders[stream].write(chunk);
    if (fragments[stream].length > 64 * 1024) throw new QuotaReadError("startup-unavailable");
    let end: number;
    while ((end = fragments[stream].indexOf("\n")) >= 0) {
      // eslint-disable-next-line no-control-regex -- Native startup may style the bearer URL with ANSI escapes.
      const line = fragments[stream].slice(0, end).replace(/\x1b\[[0-9;]*m/g, "");
      fragments[stream] = fragments[stream].slice(end + 1);
      const address = line.match(/http:\/\/(?:127\.0\.0\.1|localhost):(\d+)/);
      if (address && Number(address[1]) > 0 && Number(address[1]) <= 65535) base = address[0].replace("localhost", "127.0.0.1");
      token ??= line.match(/(?:[?#&]token=|Bearer\s+|[Tt]oken[:=]\s*)([A-Za-z0-9._~-]{20,512})(?=[\s'"<>]|$)/)?.[1];
      if (base && token) {
        completed = true;
        const authorization = "Bearer " + token;
        token = undefined; fragments.stdout = ""; fragments.stderr = "";
        ready({ base, authorization });
        return;
      }
    }
  };
}

export const readKimiQuota: QuotaReader = (runtime, signal) => inQuotaWorkspace(async (cwd) => {
  if (process.platform !== "darwin") throw new QuotaReadError("unsupported");
  const home = await createQuotaKimiHome();
  try {
    const env = { ...kimiEnvironment(runtime), KIMI_CODE_HOME: home.path, KIMI_CODE_CACHE_DIR: home.cachePath };
    const launch = wrapInteractiveWithSeatbelt({ backend: "kimi", command: runtime.executable,
      args: ["web", "--host", "127.0.0.1", "--port", "0", "--no-open"], env,
      workspace: cwd, permissionMode: "ask-for-approval", readOnlyRoots: home.readOnlyRoots,
      stateWriteRoots: home.stateWriteRoots, controlRoot: join(cwd, "control", "private"), agentRuntime: runtime.executable });
    const session = createSupervisedSession({ ...launch, backend: "kimi", cwd, env, signal });
    let authorization = "";
    let base = "";
    try {
      let ready!: (value: { base: string; authorization: string }) => void;
      const startup = new Promise<{ base: string; authorization: string }>((resolve) => { ready = resolve; });
      session.onOutput(kimiStartupParser(ready));
      try { ({ base, authorization } = await session.race(startup)); }
      catch { throw new QuotaReadError("startup-unavailable"); }
      const read = async (path: string) => {
        const response = await fetch(base + path, { headers: { Authorization: authorization }, signal, redirect: "error" });
        if (!response.ok) {
          const retry = response.headers.get("retry-after");
          const retryMs = retry === null ? NaN : /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
          await response.body?.cancel().catch(() => undefined);
          throw new QuotaReadError(response.status === 401 ? "startup-unavailable" : response.status === 404 ? "unsupported" : response.status === 429 ? "rate-limited" : "unavailable",
            Number.isFinite(retryMs) && retryMs > 0 ? retryMs : undefined);
        }
        return boundedJson(response);
      };
      const auth = object(object(await read("/api/v1/auth")).data);
      const provider = object(auth.managed_provider);
      if (provider.status === "unauthenticated") throw new QuotaReadError("needs-auth");
      if (provider.status !== "authenticated") throw new QuotaReadError("unavailable");
      return normalizeKimi(await session.race(read("/api/v1/oauth/usage")), Date.now());
    } finally {
      if (base && authorization && !signal.aborted) {
        await fetch(base + "/api/v1/shutdown", { method: "POST", headers: { Authorization: authorization },
          redirect: "error", signal: AbortSignal.timeout(1000) }).catch(() => undefined);
      }
      authorization = "";
      await session.close();
    }
  } finally { await home.release(); }
});
