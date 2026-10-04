/**
 * [INPUT]: Depends on Node child processes/events and the existing UtilityHost transport contract.
 * [OUTPUT]: Provides packageTransport: bounded JSON messages on stdin/fd3, with the UtilityHost lifecycle surface.
 * [POS]: Adapts a fenced bundled-Node child to UtilityHost; stdout never carries control messages or Electron objects.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import type { UtilityHostPorts } from "../utility-host";
import type { AgentProcessLaunch } from "../../backends/types";

const MAX_FRAME = 8 * 1024 * 1024;
export function packageTransport(launch: () => AgentProcessLaunch, journal: { record(pid: number): Promise<unknown> }): Pick<UtilityHostPorts, "channel" | "fork"> {
  let child: ChildProcess | null = null;
  const messages = new EventEmitter();
  const send = (message: unknown) => {
    const bytes = JSON.stringify(message) + "\n";
    if (Buffer.byteLength(bytes) > MAX_FRAME || (child?.stdin?.writableLength ?? 0) > MAX_FRAME * 2) {
      child?.kill(); throw new Error("package-transport-limit");
    }
    const current = child;
    if ((message as { t?: string })?.t === "launch" && current?.pid) {
      void journal.record(current.pid).then(() => { if (current.exitCode === null && current.signalCode === null) current.stdin?.write(bytes); }, () => current.kill());
    } else current?.stdin?.write(bytes);
  };
  const port = Object.assign(messages, { postMessage: send, start() {}, close() { messages.removeAllListeners(); } });
  return {
    channel: () => ({ port1: port, port2: port }) as unknown as ReturnType<UtilityHostPorts["channel"]>,
    fork: () => {
      const spec = launch();
      child = spawn(spec.command, [...spec.args], { cwd: spec.cwd, env: spec.env, detached: true, stdio: ["pipe", "ignore", "pipe", "pipe"] });
      const process = child;
      let buffer = Buffer.alloc(0), exited = false;
      process.stdin!.on("error", () => process.kill());
      (process.stdio[3] as Readable).on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        let end: number;
        while ((end = buffer.indexOf(10)) >= 0) {
          if (end > MAX_FRAME) { process.kill(); return; }
          const frame = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
          try { messages.emit("message", { data: JSON.parse(frame.toString("utf8")) }); }
          catch { process.kill(); return; }
        }
        if (buffer.length > MAX_FRAME) process.kill();
      });
      process.once("exit", () => { exited = true; });
      process.once("error", () => { if (!exited) process.emit("exit", -1); });
      return Object.assign(process, { postMessage: send }) as unknown as ReturnType<UtilityHostPorts["fork"]>;
    },
  };
}
