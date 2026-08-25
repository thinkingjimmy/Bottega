/**
 * [INPUT]: Accepts lsof field, output, target port, start group and listener PID→PGID mapping
 * [OUTPUT]: Provides parseLsofListeners and assertLoopbackListeners security tests
 * [POS]: The pure listening audit core of apps/runtime requires that each listening is circular and belongs to the startup process group
 */

export type TcpListener = {
  pid: number;
  endpoint: string;
};

export function parseLsofListeners(output: string) {
  const listeners: TcpListener[] = [];
  let pid: number | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("p")) {
      const parsed = Number(line.slice(1));
      pid = Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
    } else if (line.startsWith("n") && pid) {
      listeners.push({
        pid,
        endpoint: line.slice(1).replace(/\s+\(LISTEN\)$/, ""),
      });
    }
  }
  return listeners;
}

export function assertLoopbackListeners(
  listeners: TcpListener[],
  port: number,
  expectedProcessGroup: number,
  processGroups: ReadonlyMap<number, number>
) {
  if (listeners.length === 0) {
    throw new Error(`端口 ${port} 没有可审计的监听记录`);
  }
  for (const listener of listeners) {
    const host = endpointHost(listener.endpoint, port);
    if (host !== "127.0.0.1" && host !== "::1") {
      throw new Error(
        `App 必须只监听 127.0.0.1/::1，检测到 ${listener.endpoint}`
      );
    }
    if (processGroups.get(listener.pid) !== expectedProcessGroup) {
      throw new Error(
        `端口 ${port} 的监听进程 ${listener.pid} 不属于 App 进程组 ${expectedProcessGroup}`
      );
    }
  }
}

function endpointHost(endpoint: string, port: number) {
  const ipv6 = endpoint.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6) return Number(ipv6[2]) === port ? ipv6[1] : "";
  const separator = endpoint.lastIndexOf(":");
  if (separator < 0 || Number(endpoint.slice(separator + 1)) !== port) return "";
  return endpoint.slice(0, separator);
}
