/**
 * [INPUT]: Depends on Node events/stream and the utility host's HostApi/HostProcess
 * [OUTPUT]: Provides bridgeProcessHost with distinct delivery failure and actual exit states, and killProcessHost with delivery-aware cleanup routed through main
 * [POS]: Runs inside the Provider bridge: AcpConnection needs a synchronously returned child with stdio streams; this child is a stand-in whose streams are the process port's messages, while main alone starts, fences, journals and kills the real process
 */
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { HostApi, HostProcess } from "../../host/entry";
import type { AgentProcessHost } from "../../backends/contracts/types";

class RelayedChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  pid: number | undefined;
  exitCode: number | null = null;
  signalCode: string | null = null;
  private process: HostProcess | null = null;
  private readonly queued: string[] = [];
  private ended = false;
  private exited = false;
  private deliveryFailure: Error | null = null;
  private killRequested = false;

  constructor(private readonly binaryOutput = false) {
    super();
    this.stdin = new Writable({
      write: (chunk: Buffer | string, _encoding, done) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (this.exited || this.deliveryFailure) { done(this.deliveryFailure ?? new Error("Native process input is closed")); return; }
        if (this.process) this.process.write(text); else this.queued.push(text);
        done();
      },
      final: (done) => { this.ended = true; if (!this.exited) this.process?.end(); done(); },
    });
  }

  attach(process: HostProcess) {
    this.process = process;
    this.pid = process.pid;
    process.onOutput((stream, data) => (stream === "stdout" ? this.stdout : this.stderr).write(this.binaryOutput ? Buffer.from(data, "base64") : data));
    if (this.killRequested) { this.queued.length = 0; process.kill(); }
    else {
      for (const text of this.queued.splice(0)) process.write(text);
      if (this.ended) process.end();
    }
    this.emit("spawn");
    void process.exited.then(({ code, signal }) => {
      this.exited = true; this.exitCode = code; this.signalCode = signal;
      this.stdout.end(); this.stderr.end();
      this.emit("exit", code, signal);
      this.emit("close", code, signal);
    });
  }

  fail(cause: Error) {
    if (this.process || this.deliveryFailure) return;
    // No delivered handle is not proof that main's custody group has exited.
    this.deliveryFailure = cause;
    this.queued.length = 0;
    try { this.emit("error", cause); }
    finally {
      this.stdout.end(); this.stderr.end();
      this.emit("close", null, null);
    }
  }

  kill() {
    if (this.exited || this.deliveryFailure) return false;
    this.killRequested = true;
    this.process?.kill();
    return true;
  }
}

/**
 * `launch` ignores what the turn computed: the bridge was built with no fence and no environment, and main spawns the
 * launch it sealed on the execution ref, in custody, with exactly its environment.
 */
export function bridgeProcessHost(api: HostApi, ref: string, binaryOutput = false): AgentProcessHost & { child(): RelayedChild | null } {
  let resolve!: () => void, reject!: (cause: Error) => void;
  const delivered = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  delivered.catch(() => undefined);
  let current: RelayedChild | null = null;
  return {
    delivered,
    child: () => current,
    launch: () => {
      const child = new RelayedChild(binaryOutput);
      current = child;
      void api.spawn(ref, "sealed-plan", [], { plan: true }).then(
        (process) => { child.attach(process); resolve(); },
        (cause: Error) => { reject(cause); child.fail(cause); },
      );
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  };
}

/** The connection's group cleanup: the bridge asks main (through the process handle) instead of signalling a PID. */
export function killProcessHost(host: ReturnType<typeof bridgeProcessHost>) {
  return async () => {
    const child = host.child();
    if (!child) return { ok: true } as const;
    // Failed delivery must remain a failure, not an impossible wait or a successful cleanup claim.
    await host.delivered;
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((done) => child.once("exit", () => done()));
      child.kill();
      await exited;
    }
    return { ok: true } as const;
  };
}
