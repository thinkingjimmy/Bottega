/**
 * [INPUT]: Depends on Node net/fs/crypto, custody line protocol and socket path asserted by shared/builtin-tools
 * [OUTPUT]: Provides GuardianControlChannel: 0600 Native socket, per-custody token, the constant time between the pairs, hello/activated/failed routes and activate/stand-downs
 * [POS]: The main side control of the custody; The only agreement is to move, not know the journal phase, not decide who to kill
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { assertUnixSocketPath } from "../../../shared/builtin-tools";
import type { ProcessIdentity } from "../../../shared/app-lifecycle";
import {
  CUSTODY_LINE_LIMIT,
  encodeCustodyLine,
  guardianMessageSchema,
  type GuardianLaunch,
} from "./protocol";

export type GuardianHandlers = {
  onHello(identity: ProcessIdentity): void;
  onActivated(backendPid: number): void;
  onFailed(reason: string): void;
  /** guardian 侧连接消失；不代表进程已死，只代表控制面失联 */
  onDisconnected(): void;
};

export type GuardianLink = {
  /** guardian spawn 时只带得走这两样：连回哪里、凭什么被认领 */
  readonly socketPath: string;
  readonly token: string;
  activate(launch: GuardianLaunch): void;
  standDown(): void;
  dispose(): void;
};

type Registration = {
  token: Buffer;
  nonce: string;
  handlers: GuardianHandlers;
  socket?: Socket;
  /** hello 之前排队的下行命令；活的连接一到就冲出去 */
  queued: string[];
  disposed: boolean;
};

export class GuardianControlChannel {
  private server: Server | null = null;
  private readonly registrations = new Set<Registration>();

  constructor(readonly socketPath: string) {
    /* 超长路径的 listen() 报的是 EINVAL 之类跟「太长」毫无字面关系的错，
       而这条链上的表征会是「turn 卡在 guardian 直到启动预算耗尽」。 */
    assertUnixSocketPath(socketPath);
  }

  async listen() {
    if (this.server) return;
    await mkdir(dirname(this.socketPath), { recursive: true, mode: 0o700 });
    await unlink(this.socketPath).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== "ENOENT") throw cause;
    });
    const server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    await chmod(this.socketPath, 0o600);
    this.server = server;
  }

  /** 每个 custody 一把 token；guardian 只能凭它认领自己那条注册。 */
  register(nonce: string, handlers: GuardianHandlers): GuardianLink {
    const token = randomBytes(32).toString("hex");
    const registration: Registration = {
      token: Buffer.from(token, "utf8"),
      nonce,
      handlers,
      queued: [],
      disposed: false,
    };
    this.registrations.add(registration);
    return {
      socketPath: this.socketPath,
      token,
      activate: (launch) =>
        this.write(registration, { v: 1, kind: "activate", nonce, launch }),
      standDown: () =>
        this.write(registration, { v: 1, kind: "stand-down", nonce }),
      dispose: () => {
        registration.disposed = true;
        registration.queued.length = 0;
        this.registrations.delete(registration);
        registration.socket?.destroy();
      },
    };
  }

  async close() {
    for (const registration of [...this.registrations]) {
      registration.disposed = true;
      registration.socket?.destroy();
    }
    this.registrations.clear();
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server.close((cause) => (cause ? reject(cause) : resolve()))
      );
    }
    await unlink(this.socketPath).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== "ENOENT") throw cause;
    });
  }

  private write(
    registration: Registration,
    command: Parameters<typeof encodeCustodyLine>[0]
  ) {
    if (registration.disposed) return;
    const line = encodeCustodyLine(command);
    if (registration.socket && !registration.socket.destroyed) {
      registration.socket.write(line);
      return;
    }
    registration.queued.push(line);
  }

  private accept(socket: Socket) {
    socket.setEncoding("utf8");
    let bound: Registration | undefined;
    let pending = "";
    socket.on("error", () => socket.destroy());
    socket.once("close", () => {
      if (bound?.socket === socket) {
        bound.socket = undefined;
        if (!bound.disposed) bound.handlers.onDisconnected();
      }
    });
    socket.on("data", (chunk: string) => {
      pending += chunk;
      if (Buffer.byteLength(pending, "utf8") > CUSTODY_LINE_LIMIT) {
        socket.destroy();
        return;
      }
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.trim()) {
          /* 已认领的连接即使发了非法报文也不解绑：解绑会让随后的 close
             静默掉，而「guardian 交付前失联」正是靠那条 close 说出来的。 */
          bound = this.dispatch(socket, line, bound) ?? bound;
          if (socket.destroyed) return;
        }
        newline = pending.indexOf("\n");
      }
    });
  }

  private dispatch(socket: Socket, line: string, bound?: Registration) {
    const parsed = guardianMessageSchema.safeParse(safeJson(line));
    if (!parsed.success) {
      socket.destroy();
      return undefined;
    }
    const message = parsed.data;
    if (message.kind === "hello") {
      if (bound) {
        socket.destroy();
        return undefined;
      }
      const registration = this.authenticate(message.token, message.nonce);
      if (!registration) {
        socket.destroy();
        return undefined;
      }
      registration.socket = socket;
      for (const queued of registration.queued.splice(0)) socket.write(queued);
      registration.handlers.onHello(message.identity);
      return registration;
    }
    /* activated/failed 必须来自已完成 hello 的同一条连接：没有 hello 就没有
       身份，而没有身份的「我起来了」正是 owned 之前最不能相信的一句话。 */
    if (!bound || bound.nonce !== message.nonce) {
      socket.destroy();
      return undefined;
    }
    if (message.kind === "activated") bound.handlers.onActivated(message.backendPid);
    else bound.handlers.onFailed(message.reason);
    return bound;
  }

  private authenticate(token: string, nonce: string) {
    const candidate = Buffer.from(token, "utf8");
    let matched: Registration | undefined;
    /* 逐条常量时间比对，且不提前 return：命中与否都走完同样长度的循环，
       token 本身不通过时序泄漏。 */
    for (const registration of this.registrations) {
      const equal =
        registration.token.length === candidate.length &&
        timingSafeEqual(registration.token, candidate);
      if (equal && registration.nonce === nonce && !registration.socket) {
        matched = registration;
      }
    }
    return matched?.disposed ? undefined : matched;
  }
}

function safeJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
