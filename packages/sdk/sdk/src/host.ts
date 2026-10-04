/**
 * [INPUT]: Depends on the public launch contract and the host protocol and API types (@bottega/contracts/host/*). No Electron or Node process import: the embedder injects exit, pid and module loading.
 * [OUTPUT]: Provides runPackageHost(port, launch, options) and the HostPort interface it needs.
 * [POS]: The package-side host runtime, in one public place: the desktop's utility-host entry wraps it with Electron's parentPort, and @bottega/testing drives the same function. It checks the launch contract before anything else, imports the approved entry, calls its activate(api), says hello and relays invoke/rpc/process messages.
 */
import type { HostApi, HostHandler as Handler } from "@bottega/contracts/host/api";
import { HOST_LAUNCH_CONTRACT } from "@bottega/contracts/host/contract";
import type { HostToBridge } from "@bottega/contracts/host/protocol";

/** The MessagePort surface the runtime needs (Electron's MessagePortMain shape: events carry `{ data }`). */
export type HostPort = {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): unknown;
  start(): void;
};
export type HostLaunch = Extract<HostToBridge, { t: "launch" }>;
/* Injected, never assumed: a library that called process.exit would end whatever embeds it, a Worker has no pid of its own
   (main compares hello's pid with the child it forked), and only the embedder knows how to load the approved entry. */
export type RunPackageHostOptions = {
  exit: (code: number) => void;
  pid: number;
  load: (entry: string) => Promise<{ activate?(api: HostApi): Record<string, Handler> | Promise<Record<string, Handler>> }>;
};

export function runPackageHost(port: HostPort, launch: HostLaunch, options: RunPackageHostOptions): void {
  /* The frozen launch contract, first: another contract is refused before any handler, port start or import, naming ours. */
  const contract = HOST_LAUNCH_CONTRACT.version;
  if (launch.contract !== contract) {
    port.postMessage({ t: "refused", reason: "contract", contract });
    options.exit(1);
    return;
  }
  const { exit, pid, load } = options;
  let sequence = 0;
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  const processes = new Map<string, { output: ((stream: "stdout" | "stderr", data: string) => void)[]; exit(value: { code: number | null; signal: string | null }): void }>();
  const next = () => `r${++sequence}`;
  const post = (message: object) => port.postMessage(message);
  let handlers: Record<string, Handler> = {};

  const api: HostApi = {
    hostId: launch.plan.hostId, kind: launch.plan.kind,
    call: (operation, input, refs) => new Promise((resolve, reject) => {
      const id = next(); pending.set(id, { resolve, reject });
      post({ t: "rpc", request: { v: 1, id, operation, input, refs } });
    }),
    spawn: (ref, command, args, options = {}) => new Promise((resolve, reject) => {
      const id = next();
      pending.set(id, { reject, resolve: (value) => {
        const { processId, pid } = value as { processId: string; pid: number };
        const output: ((stream: "stdout" | "stderr", data: string) => void)[] = [];
        let exit!: (value: { code: number | null; signal: string | null }) => void;
        const exited = new Promise<{ code: number | null; signal: string | null }>(done => { exit = done; });
        processes.set(processId, { output, exit });
        resolve({ processId, pid, exited, onOutput: listener => { output.push(listener); },
          write: data => post({ t: "process-stdin", processId, data }), end: () => post({ t: "process-stdin", processId, end: true }),
          kill: () => post({ t: "process-kill", processId }) });
      } });
      post({ t: "process-spawn", id, ref, command, args, ...(options.cwd ? { cwd: options.cwd } : {}), ...(options.env ? { env: options.env } : {}),
        ...(options.custody ? { custody: true } : {}), ...(options.plan ? { plan: true } : {}) });
    }),
  };

  port.on("message", async ({ data }) => {
    const message = data as HostToBridge;
    if (message.t === "rpc-result") {
      const waiting = pending.get(message.response.id); pending.delete(message.response.id);
      if (message.response.ok) waiting?.resolve(message.response.result);
      else waiting?.reject(Object.assign(new Error(message.response.error.message), { code: message.response.error.code }));
    } else if (message.t === "process-spawned") {
      const waiting = pending.get(message.id); pending.delete(message.id);
      if (message.ok) waiting?.resolve({ processId: message.processId, pid: message.pid }); else waiting?.reject(new Error(message.error));
    } else if (message.t === "process-event") {
      for (const listener of processes.get(message.processId)?.output ?? []) listener(message.stream, message.data);
    } else if (message.t === "process-exit") {
      processes.get(message.processId)?.exit({ code: message.code, signal: message.signal }); processes.delete(message.processId);
    } else if (message.t === "invoke") {
      try {
        const handler = handlers[message.method];
        if (!handler) throw new Error(`unknown method ${message.method}`);
        post({ t: "invoke-result", id: message.id, ok: true, result: await handler(message.params, message.refs) ?? null });
      } catch (cause) {
        post({ t: "invoke-result", id: message.id, ok: false, error: String((cause as Error)?.message ?? cause).slice(0, 1024) });
      }
    }
  });
  port.start();

  void (async () => {
    const module = await load(launch.plan.entry);
    if (typeof module.activate !== "function") throw new Error("host entry exports no activate()");
    handlers = await module.activate(api) ?? {};
    post({ t: "hello", grammar: launch.grammar, contract, hostId: launch.plan.hostId, pid });
  })().catch((cause) => {
    console.error(`[host] ${launch.plan.hostId} failed to activate`, cause);
    exit(1);
  });
}
