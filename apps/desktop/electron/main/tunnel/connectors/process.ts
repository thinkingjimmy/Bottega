/**
 * [INPUT]: The shared verified supply, a loopback proxy, OS birth identity and the orphan watchdog.
 * [OUTPUT]: launchConnector with a verified private executable snapshot, bounded diagnostics and confirmed process-group shutdown.
 * [POS]: The one cloudflared process launch path used by both preview and server consumers.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import type { TunnelSupply } from "../runtime/supply";
import { probeProcessBirth } from "../../custody/identity";
import { trackAuxiliaryProcessGroup } from "../../agent/process/agent-process-watchdog";
import { cleanOwnedProcessGroup } from "../../agent/process/process-group";

export type ConnectorProcess = { metrics: string; exited: Promise<void>; close(): Promise<void> };
async function metricsPort() {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
export async function launchConnector(supply: Pick<TunnelSupply, "prepareLaunch">, proxyPort: number): Promise<ConnectorProcess> {
  if (!Number.isInteger(proxyPort) || proxyPort < 1024 || proxyPort > 65535) throw new Error("tunnel-target-invalid");
  const metrics = `http://127.0.0.1:${await metricsPort()}`, launch = await supply.prepareLaunch();
  let owned = false;
  try {
    const args = ["tunnel", "--config", "/dev/null", "--no-autoupdate", "--protocol", "http2", "--metrics", metrics.slice(7),
      "--url", `http://127.0.0.1:${proxyPort}`, "--http-host-header", `localhost:${proxyPort}`];
    const child = spawn(launch.path, args, { detached: true, cwd: "/", env: { PATH: "/usr/bin:/bin" }, stdio: ["ignore", "ignore", "pipe"] });
    let closed = false, untrack = () => {};
    const exited = new Promise<void>(resolve => { child.once("exit", () => { untrack(); resolve(); }); child.once("error", () => resolve()); });
    // Consume diagnostics without persisting hostnames, environment or incidental service output.
    child.stderr?.on("data", () => {});
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    const identity = probeProcessBirth(child.pid!);
    const close = async () => {
      if (closed) return; closed = true;
      const result = await cleanOwnedProcessGroup({ pid: child.pid!, birthIdentity: identity?.birthIdentity ?? null });
      if (!result.ok) { closed = false; throw result.error; }
      await exited; untrack();
    };
    try {
      if (!identity || identity.processGroupId !== child.pid) throw new Error("tunnel-process-unverified");
      untrack = trackAuxiliaryProcessGroup(child.pid, identity.birthIdentity, true);
    } catch (error) { await close(); throw error; }
    owned = true;
    const cleaned = exited.then(() => launch.close()); cleaned.catch(() => undefined);
    return { metrics, exited: cleaned, close: async () => { await close(); await cleaned; } };
  } finally { if (!owned) await launch.close(); }
}
