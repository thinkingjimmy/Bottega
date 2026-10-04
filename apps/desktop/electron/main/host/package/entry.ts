/**
 * [INPUT]: Depends on Node fs/events/url and the public package host runtime.
 * [OUTPUT]: Runs the pinned package module over bounded stdin/fd3 messages on bundled Node.
 * [POS]: Electron-free package entry; the parent establishes Seatbelt before any package code loads.
 */
import { writeSync } from "node:fs";
import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import { runPackageHost, type HostLaunch } from "@bottega/sdk/host";

const MAX_FRAME = 8 * 1024 * 1024;
const port = Object.assign(new EventEmitter(), {
  postMessage(message: unknown) {
    const bytes = Buffer.from(JSON.stringify(message) + "\n");
    if (bytes.length > MAX_FRAME) process.exit(1);
    for (let offset = 0; offset < bytes.length;) offset += writeSync(3, bytes, offset, bytes.length - offset);
  },
  start() {},
});
let launched = false, buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  let end: number;
  while ((end = buffer.indexOf(10)) >= 0) {
    if (end > MAX_FRAME) process.exit(1);
    const frame = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
    let data: unknown;
    try { data = JSON.parse(frame.toString("utf8")); } catch { process.exit(1); }
    if (!launched) {
      launched = true;
      runPackageHost(port, data as HostLaunch, { exit: process.exit, pid: process.pid, load: entry => import(pathToFileURL(entry).href) });
    } else port.emit("message", { data });
  }
  if (buffer.length > MAX_FRAME) process.exit(1);
});
process.stdin.once("end", () => process.exit(0));
process.stdin.once("error", () => process.exit(1));
