/**
 * [INPUT]: Depends on Node http/net/fs, bounded gateway request/upgrade handlers, and the durable port settings file
 * [OUTPUT]: Provides port candidate probing, the listening HTTP server with explicit accepted-connection custody, atomic port settings persistence, and internal upstream port allocation
 * [POS]: AppGateway transport lifecycle leaf; route resolution, CSP composition and request admission stay in app-gateway.ts
 */

import { readFile, rename, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer, type Server as NetServer } from "node:net";
import type { Duplex } from "node:stream";
import { GatewayConnectionCustody } from "./gateway-request-leases";

export const GATEWAY_DEFAULT_PORT = 4700;
const UPSTREAM_PORT_FLOOR = 4100;

export type GatewayServerHandlers = Readonly<{
  request(request: IncomingMessage, response: ServerResponse): void;
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
}>;

export class GatewayHttpServer {
  private readonly connections = new GatewayConnectionCustody();
  private server: Server | null = null;
  private bound = GATEWAY_DEFAULT_PORT;

  constructor(private readonly settingsPath: string) {}

  get port() {
    return this.bound;
  }

  /* 上一次成功的端口优先复用：App 的本地数据按 origin 分区，换端口等于换
     origin，等于把 localStorage/IndexedDB 一起丢掉，所以换端口必须告警。 */
  async start(
    handlers: GatewayServerHandlers,
    onWarning: (message: string) => void
  ) {
    const saved = await this.readSettings();
    const fallbacks = Array.from(
      { length: 10 },
      (_unused, index) => GATEWAY_DEFAULT_PORT + index
    );
    const candidates = saved
      ? [saved, ...fallbacks.filter((port) => port !== saved)]
      : fallbacks;
    let lastError: Error | null = null;
    for (const candidate of candidates) {
      try {
        this.server = await this.listen(candidate, handlers);
        this.bound = candidate;
        await this.writeSettings(candidate);
        if (saved !== null && saved !== candidate) {
          onWarning(
            `App 网关端口 ${saved} 被占用，已切换到 ${candidate}；App 本地数据将重置。`
          );
        }
        return;
      } catch (cause) {
        lastError = cause instanceof Error ? cause : new Error(String(cause));
      }
    }
    throw lastError ?? new Error("无法启动 App 网关");
  }

  async close() {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await this.connections.close(server);
  }

  async allocateUpstreamPort() {
    for (let port = UPSTREAM_PORT_FLOOR; port < GATEWAY_DEFAULT_PORT; port += 1) {
      if (await canListen(port)) return port;
    }
    throw new Error("没有可用的 App 内部端口");
  }

  private async listen(port: number, handlers: GatewayServerHandlers) {
    const server = createHttpServer(handlers.request);
    server.on("connection", (connection) => this.connections.track(connection));
    server.on("upgrade", handlers.upgrade);
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: Error) => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolvePromise();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
    return server;
  }

  private async readSettings(): Promise<number | null> {
    try {
      const parsed = JSON.parse(await readFile(this.settingsPath, "utf8"));
      return Number.isInteger(parsed.port) ? (parsed.port as number) : null;
    } catch {
      return null;
    }
  }

  private async writeSettings(port: number) {
    const temporary = `${this.settingsPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ port }, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.settingsPath);
  }
}

async function canListen(port: number) {
  let server: NetServer | null = createServer();
  try {
    await new Promise<void>((resolvePromise, reject) => {
      server!.once("error", reject);
      server!.listen(port, "127.0.0.1", resolvePromise);
    });
    return true;
  } catch {
    return false;
  } finally {
    if (server?.listening) {
      await new Promise<void>((resolvePromise) =>
        server!.close(() => resolvePromise())
      );
    }
    server = null;
  }
}
