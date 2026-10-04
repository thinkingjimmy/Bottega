/**
 * [INPUT]: Depends on node:worker_threads and the public package-side host runtime (@bottega/sdk/host).
 * [OUTPUT]: The worker body of the fake host: adapts a Node MessagePort to the MessagePortMain shape ({ data }) and runs runPackageHost on the launch it receives.
 * [POS]: Utility side of the T1 fake host; the package inside it runs on the same runtime the desktop's utility process uses. exit ends only this worker thread; pid is the runner's own.
 */
import { pathToFileURL } from "node:url";
import { parentPort, type MessagePort } from "node:worker_threads";
import { runPackageHost, type HostLaunch, type HostPort } from "@bottega/sdk/host";

/* MessagePortMain emits { data }; a Node MessagePort emits the value itself. */
const asMain = (port: MessagePort): HostPort => ({
  on(event, listener) { return port.on(event, (data: unknown) => listener({ data })); },
  postMessage(message) { port.postMessage(message); },
  start() { port.start(); },
});

parentPort!.once("message", ({ launch, port }: { launch: HostLaunch; port: MessagePort }) => {
  runPackageHost(asMain(port), launch, {
    exit: (code) => process.exit(code), pid: process.pid,
    load: (entry) => import(pathToFileURL(entry).href),
  });
});
