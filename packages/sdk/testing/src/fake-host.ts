/**
 * [INPUT]: Depends on node:worker_threads, node:crypto and the public host protocol (@bottega/contracts/host/protocol).
 * [OUTPUT]: Provides startFakeHost (the main side of the host protocol for one package entry: issues refs, answers scripted operations, invokes package methods, injects deterministic reply faults, records a transcript) and issueRef.
 * [POS]: The public T1 host of @bottega/testing. The package runs on the real package-side runtime in a worker; see README.md for what this does not emulate.
 */
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MessageChannel, Worker } from "node:worker_threads";
import { bridgeMessageSchema, HOST_GRAMMAR, HOST_LAUNCH_CONTRACT, type HostKind } from "@bottega/contracts/host/protocol";

/* Located by package self-reference, never relative to this module: the build may place this code in a shared chunk. */
const shim = fileURLToPath(import.meta.resolve("@bottega/testing/shim"));
const source = shim.endsWith(".ts");
/* The packed kit is plain JavaScript. Source (.ts) runs in the development workspace only, where a worker does not inherit the
   parent's loader and ignores --import, so it registers tsx itself before importing the shim. */
const startShim = () => source
  ? new Worker(`import(${JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm/api")).href)})
      .then((tsx) => { tsx.register(); return import(${JSON.stringify(pathToFileURL(shim).href)}); })`, { eval: true, stdout: true, stderr: true })
  : new Worker(shim, { stdout: true, stderr: true });

/** A host-issued, unguessable ref of the given kind, in the real wire format. */
export const issueRef = (kind: string) => `cap_${kind}_${randomBytes(32).toString("base64url")}`;

export type FakeHostOptions = {
  entry: string; hostId?: string; kind?: HostKind; grammar?: number; contract?: string; helloTimeoutMs?: number;
  operations?: Record<string, (input: Record<string, unknown>, refs: string[]) => unknown>;
  faults?: { duplicateReply?: string[]; dropReply?: string[]; lateReplyMs?: Record<string, number> };
};
/** A message as it crossed the port; `request` is set on rpc messages from the utility. */
export type WireMessage = { t?: string; request?: { id: string; operation: string; refs?: string[] } } & Record<string, unknown>;
export type TranscriptEntry = { dir: "to-utility" | "from-utility"; message: WireMessage; valid?: boolean };
export type InvokeResult = { t: "invoke-result"; id: string; ok: boolean; result?: unknown; error?: string };

export async function startFakeHost({ entry, hostId = "conformance-host", kind = "extension-host", grammar = HOST_GRAMMAR,
  contract = HOST_LAUNCH_CONTRACT.version, operations = {}, faults = {}, helloTimeoutMs = 10_000 }: FakeHostOptions) {
  const transcript: TranscriptEntry[] = [], rejected: unknown[] = [], fired = new Map<string, number>(), pending = new Map<string, (value: InvokeResult) => void>();
  const fire = (fault: string, operation: string) => { const key = `${fault}:${operation}`; fired.set(key, (fired.get(key) ?? 0) + 1); };
  const worker = startShim();
  const exit = new Promise<{ code: number }>((resolve) => worker.once("exit", (code) => resolve({ code })));
  const channel = new MessageChannel(), port = channel.port1;
  const post = (message: WireMessage) => { transcript.push({ dir: "to-utility", message }); port.postMessage(message); };
  let sequence = 0, hello!: { resolve(value: unknown): void; reject(error: Error): void };
  const ready = new Promise((resolve, reject) => {
    hello = { resolve, reject };
    /* Kept ref'd: a host that never says hello fails the case by name instead of letting the process end with it unsettled. */
    const timer = setTimeout(() => reject(new Error("fake-host-hello-timeout")), helloTimeoutMs);
    void exit.then(({ code }) => { clearTimeout(timer); reject(new Error(`fake-host-exited-before-hello: ${code}`)); });
  });
  void ready.catch(() => undefined);
  port.on("message", async (raw: unknown) => {
    const parsed = bridgeMessageSchema.safeParse(raw);
    transcript.push({ dir: "from-utility", message: raw as WireMessage, valid: parsed.success });
    if (!parsed.success) { rejected.push(raw); return; }
    const message = parsed.data;
    if (message.t === "hello") {
      if (message.hostId !== hostId) hello.reject(new Error("fake-host-hello-identity")); else hello.resolve(message);
    } else if (message.t === "refused") {
      hello.reject(new Error(`fake-host-refused: ${message.reason} ${message.contract}`));
    } else if (message.t === "invoke-result") {
      const waiting = pending.get(message.id); pending.delete(message.id);
      waiting?.(message as InvokeResult);
    } else if (message.t === "rpc") {
      const { id, operation, input, refs = [] } = message.request;
      const handler = operations[operation];
      let response;
      try {
        response = handler ? { v: 1, id, ok: true, result: await handler(input as Record<string, unknown>, refs) ?? null }
          : { v: 1, id, ok: false, error: { code: "unknown-operation", message: operation } };
      } catch (cause) {
        const error = cause as { code?: string; message?: string };
        response = { v: 1, id, ok: false, error: { code: error?.code ?? "operation-failed", message: String(error?.message ?? cause).slice(0, 1024) } };
      }
      if (faults.dropReply?.includes(operation)) { fire("drop", operation); return; }
      const delay = faults.lateReplyMs?.[operation];
      if (delay) { fire("late", operation); await new Promise((resolve) => setTimeout(resolve, delay)); }
      post({ t: "rpc-result", response });
      if (faults.duplicateReply?.includes(operation)) { fire("duplicate", operation); post({ t: "rpc-result", response }); }
    } else if (message.t === "process-spawn") {
      // The fake host never starts processes; a case that needs one uses the real host E2E.
      post({ t: "process-spawned", id: message.id, ok: false, error: "fake-host-no-spawn" });
    }
  });
  port.start();
  worker.postMessage({ launch: { t: "launch", grammar, contract, plan: { hostId, kind, entry, entrySha256: "0".repeat(64), env: {} } }, port: channel.port2 }, [channel.port2]);
  return {
    contract, grammar, transcript, rejected, fired, ready, exit,
    /** Calls a method the package's activate() returned; resolves with the raw invoke-result. */
    invoke(method: string, params: unknown = null, refs: string[] = []) {
      const id = `i${++sequence}`;
      return new Promise<InvokeResult>((resolve) => { pending.set(id, resolve); post({ t: "invoke", id, method, params, refs }); });
    },
    async stop() { await worker.terminate(); port.close(); return exit; },
  };
}
export type FakeHost = Awaited<ReturnType<typeof startFakeHost>>;
