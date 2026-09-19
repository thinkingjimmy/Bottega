/**
 * [INPUT]: Depends on the Kimi runtime, disposable query home, Seatbelt and a supervised loopback server.
 * [OUTPUT]: Opens a warm loopback quota channel and the one-shot reader over it; startup bearer bytes never enter diagnostics.
 * [POS]: Kimi quota adapter; native locks and credential persistence remain intact.
 */
import { StringDecoder } from "node:string_decoder";
import { join } from "node:path";
import { kimiEnvironment } from "../../backends/kimi/home";
import { wrapInteractiveWithSeatbelt } from "../../backends/sandbox/seatbelt";
import { createSupervisedSession } from "../../backends/supervised-session";
import { normalizeKimi } from "../normalization";
import { createQuotaKimiHome } from "./kimi-home";
import { boundedJson, object, openQuotaWorkspace, QuotaReadError, readOnce, whenAborted, type QuotaChannelOpener } from "./common";

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

/* The loopback half of the channel. The server prints its address and bearer once, so both
   are captured once and live exactly as long as that process: every later read is two HTTP
   round trips against them, and nothing outside this closure ever sees the bearer. */
export function kimiUsageSession(base: string, authorization: string) {
  const request = async (path: string, signal: AbortSignal) => {
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
  return {
    async read(signal: AbortSignal) {
      const auth = object(object(await request("/api/v1/auth", signal)).data);
      const provider = object(auth.managed_provider);
      if (provider.status === "unauthenticated") throw new QuotaReadError("needs-auth");
      if (provider.status !== "authenticated") throw new QuotaReadError("unavailable");
      return normalizeKimi(await request("/api/v1/oauth/usage", signal), Date.now());
    },
    /** A managed shutdown lets the native server release its locks before the group is cleaned. */
    async shutdown() {
      await fetch(base + "/api/v1/shutdown", { method: "POST", headers: { Authorization: authorization },
        redirect: "error", signal: AbortSignal.timeout(1000) }).catch(() => undefined);
    },
  };
}

export const openKimiQuotaChannel: QuotaChannelOpener = async (runtime, signal) => {
  if (process.platform !== "darwin") throw new QuotaReadError("unsupported");
  /* The channel outlives the read that opened it, so the process follows its own lifetime,
     never that read's signal; cancelling an open only unwinds what was already built. */
  const lifetime = new AbortController();
  const cleanup: (() => Promise<unknown>)[] = [];
  const close = async () => {
    lifetime.abort();
    for (const step of cleanup.splice(0).reverse()) await step().catch(() => undefined);
  };
  try {
    signal.throwIfAborted();
    const workspace = await openQuotaWorkspace();
    cleanup.push(workspace.release);
    const home = await createQuotaKimiHome();
    cleanup.push(home.release);
    const env = { ...kimiEnvironment(runtime), KIMI_CODE_HOME: home.path, KIMI_CODE_CACHE_DIR: home.cachePath };
    const launch = wrapInteractiveWithSeatbelt({ backend: "kimi", command: runtime.executable,
      args: ["web", "--host", "127.0.0.1", "--port", "0", "--no-open"], env,
      workspace: workspace.cwd, permissionMode: "ask-for-approval", readOnlyRoots: home.readOnlyRoots,
      stateWriteRoots: home.stateWriteRoots, controlRoot: join(workspace.cwd, "control", "private"), agentRuntime: runtime.executable });
    const session = createSupervisedSession({ ...launch, backend: "kimi", cwd: workspace.cwd, env, signal: lifetime.signal });
    cleanup.push(session.close);
    let ready!: (value: { base: string; authorization: string }) => void;
    const startup = new Promise<{ base: string; authorization: string }>((resolve) => { ready = resolve; });
    session.onOutput(kimiStartupParser(ready));
    const started = await Promise.race([session.race(startup), whenAborted(signal)])
      .catch((cause: unknown) => { throw signal.aborted ? cause : new QuotaReadError("startup-unavailable"); });
    const usage = kimiUsageSession(started.base, started.authorization);
    cleanup.push(usage.shutdown);
    return { read: (readSignal: AbortSignal) => session.race(usage.read(readSignal)), close };
  } catch (cause) { await close(); throw cause; }
};

export const readKimiQuota = readOnce(openKimiQuotaChannel);
