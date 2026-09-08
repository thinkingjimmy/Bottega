/**
 * [INPUT]: Depends on the packaged screen helper executable and a bounded versioned JSON-line protocol.
 * [OUTPUT]: Provides validated screen updates, acknowledged focus capture, focus restoration, and child cleanup.
 * [POS]: Narrow Node-to-AppKit bridge; task contents never cross this pipe.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { z } from "zod";
import type { NativeScreen } from "./geometry";
const rect = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative() });
const schema = z.object({ version: z.literal(1), screens: z.array(z.object({ id: z.number().int(), builtin: z.boolean(), primary: z.boolean(),
  bounds: rect, visible: rect, topInset: z.number().min(0).max(200), left: rect, right: rect, fullscreen: z.boolean(), inactive: z.boolean().default(false) })).max(16) });
export class NativeScreenBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private focus: { resolve(): void; reject(cause: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;
  constructor(private readonly path: string, private readonly receive: (screens: NativeScreen[]) => void, private readonly failed: () => void) {}
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      let ready = false; let buffer = "";
      const child = spawn(this.path, [], { stdio: "pipe" }); this.child = child;
      const timeout = setTimeout(() => { this.close(); reject(new Error("NATIVE_SCREEN_TIMEOUT")); }, 3_000);
      const fail = () => { clearTimeout(timeout); if (this.child !== child) return; this.child = null; child.kill();
        if (this.focus) { clearTimeout(this.focus.timer); this.focus.reject(new Error("NATIVE_FOCUS_CLOSED")); this.focus = null; }
        if (!ready) reject(new Error("NATIVE_SCREEN_UNAVAILABLE")); this.failed(); };
      child.on("error", fail); child.on("exit", fail); child.stdin.on("error", fail);
      child.stderr.resume();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk; if (buffer.length > 32_768) { child.kill(); fail(); return; }
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try {
            const message = JSON.parse(line);
            if (message.version === 1 && message.focusRemembered === true) {
              if (this.focus) { clearTimeout(this.focus.timer); this.focus.resolve(); this.focus = null; }
              continue;
            }
            const value = schema.parse(message); this.receive(value.screens);
            if (!ready) { ready = true; clearTimeout(timeout); resolve(); }
          } catch { child.kill(); fail(); }
        }
      });
    });
  }
  rememberFocus(): Promise<void> {
    if (!this.child || this.focus) return Promise.reject(new Error("NATIVE_FOCUS_UNAVAILABLE"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.focus = null; reject(new Error("NATIVE_FOCUS_TIMEOUT")); }, 500);
      this.focus = { resolve, reject, timer }; this.child!.stdin.write("remember-focus\n");
    });
  }
  command(command: "restore-focus" | "refresh") { this.child?.stdin.write(`${command}\n`); }
  close() {
    if (this.focus) { clearTimeout(this.focus.timer); this.focus.reject(new Error("NATIVE_FOCUS_CLOSED")); this.focus = null; }
    const child = this.child; this.child = null; child?.stdin.end(); child?.kill(); }
}
