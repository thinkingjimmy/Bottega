/**
 * [INPUT]: Depends on Electron's utility-process parentPort, Node url and the public package-side host runtime (@bottega/sdk/host).
 * [OUTPUT]: The utility-process entry (`utility-host-entry.js`): hands the first launch message and its MessagePort to runPackageHost, injecting process.exit, process.pid and the dynamic import of the approved entry.
 * [POS]: Runs inside the utility process, not main. All of the runtime (contract check first, activate, hello, invoke/rpc/process relay) is runPackageHost, shared with the public testing kit; package code sees only HostApi, never a main-process object.
 */
import { pathToFileURL } from "node:url";
import type { MessagePortMain } from "electron";
import { runPackageHost, type HostLaunch } from "@bottega/sdk/host";

export type { HostApi, HostProcess } from "@bottega/contracts/host/api";

const parent = (process as unknown as { parentPort: { once(event: "message", listener: (event: { data: unknown; ports: MessagePortMain[] }) => void): void } }).parentPort;

parent.once("message", ({ data, ports }) => runPackageHost(ports[0]!, data as HostLaunch, {
  exit: process.exit, pid: process.pid, load: (entry) => import(pathToFileURL(entry).href),
}));
