/**
 * [INPUT]: Depends on custody control protocols, Node net/child_process/fs and identity probe; socket/token/nonce only when spawn
 * [OUTPUT]: The process is backend-based, with the ability to activate the process as a process manager instead of the main, and the process is backend-based: return authentication, etc
 * [POS]: The custody is a separate guardian process input (Electron run-as-node); I don't understand the chat, the App or any product ledger
 */

import { spawn, type ChildProcess } from "node:child_process";
import { writeSync } from "node:fs";
import { createConnection } from "node:net";
import {
  CUSTODY_ENV,
  CUSTODY_LINE_LIMIT,
  GUARDIAN_EXIT,
  custodyCommandSchema,
  encodeCustodyLine,
  type CustodyCommand,
  type GuardianLaunch,
  type GuardianMessage,
} from "./protocol";
import { executableIdentity, probeProcessBirth } from "./identity";

/* fd 2 直接 writeSync，不碰 `process.stderr`：后者对管道会建 libuv handle 并
   置 O_NONBLOCK——那是 backend 即将继承的同一个 file description；而且它是异步
   写，紧跟其后的 process.exit 会把诊断整条丢掉。 */
function die(code: number, message: string): never {
  try {
    writeSync(2, `[custody-guardian] ${message}\n`);
  } catch {
    /* stderr 已经关掉时没有第二条诊断通道，退出码本身就是结论 */
  }
  process.exit(code);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) die(GUARDIAN_EXIT.protocol, `缺少控制环境 ${name}`);
  return value;
}

const socketPath = requireEnv(CUSTODY_ENV.socket);
const token = requireEnv(CUSTODY_ENV.token);
const nonce = requireEnv(CUSTODY_ENV.nonce);
/* 控制凭据到此为止：交付的 launch env 由 main 全量提供，guardian 不向 backend
   泄漏自己的通道身份，backend 也就无从冒充 guardian 说话。 */
delete process.env[CUSTODY_ENV.socket];
delete process.env[CUSTODY_ENV.token];
delete process.env[CUSTODY_ENV.nonce];

const birth = probeProcessBirth(process.pid);
if (!birth) die(GUARDIAN_EXIT.protocol, "无法取得自身 process birth identity");

let child: ChildProcess | undefined;
let closing = false;
const socket = createConnection(socketPath);
socket.setEncoding("utf8");

/* ============================================================
 * 自停规则：**尚未持有 capability** 时控制通道消失即退出。
 *
 * 交付之前 guardian 什么都不是——没有 backend、没有读写根、没有围栏，
 * 留着它只会变成一个没人认领的孤儿进程组。交付之后规则反转：main 可能
 * 只是崩了，而 backend 此刻正持着能力在跑，guardian 必须活到它死为止，
 * 否则进程组就散了，重启后的 reconcile 连该杀谁都说不出来。
 * ============================================================ */
socket.once("close", () => {
  if (!child) die(GUARDIAN_EXIT.orphaned, "控制通道在交付 capability 前断开");
});
socket.once("error", (cause) => {
  if (!child) die(GUARDIAN_EXIT.orphaned, `控制通道不可用：${cause.message}`);
});

socket.once("connect", () => {
  send({
    v: 1,
    kind: "hello",
    token,
    nonce,
    identity: {
      pid: process.pid,
      processGroupId: birth.processGroupId,
      birthIdentity: birth.birthIdentity,
      executableIdentity: executableIdentity(process.execPath),
    },
  });
});

let pending = "";
socket.on("data", (chunk: string) => {
  pending += chunk;
  if (Buffer.byteLength(pending, "utf8") > CUSTODY_LINE_LIMIT) {
    die(GUARDIAN_EXIT.protocol, "控制报文超出上限");
  }
  let newline = pending.indexOf("\n");
  while (newline >= 0) {
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    if (line.trim()) handle(line);
    newline = pending.indexOf("\n");
  }
});

function handle(line: string) {
  let command: CustodyCommand;
  try {
    command = custodyCommandSchema.parse(JSON.parse(line));
  } catch {
    die(GUARDIAN_EXIT.protocol, "控制报文非法");
  }
  if (command.nonce !== nonce) {
    die(GUARDIAN_EXIT.protocol, "控制报文 nonce 不匹配");
  }
  if (command.kind === "stand-down") {
    closing = true;
    die(GUARDIAN_EXIT.standDown, "main 要求下线");
  }
  if (child) return; // activate 幂等：capability 只交付一次
  activate(command.launch);
}

/* ============================================================
 * stdio 直接 inherit：guardian 的 0/1/2 本就是 main 建的管道，backend 继承
 * 它们即与 main 直连。多一跳代理转发既是热 NDJSON 流上的拷贝成本，也是第二
 * 个故障面——那条链一旦卡住，症状会表现成「模型不说话」。
 * ============================================================ */
function activate(launch: GuardianLaunch) {
  const backend = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    stdio: "inherit",
  });
  child = backend;
  backend.once("error", (cause) => {
    send({ v: 1, kind: "failed", nonce, reason: cause.message });
    /* 交付已经发生，但 backend 从未成立：此刻 guardian 是唯一知情者，必须
       自己收口，否则 main 只能等启动预算耗尽再说一句泛泛超时。ref 住的
       延时是给 socket 的刷出窗口，不能 unref。 */
    setTimeout(
      () => die(GUARDIAN_EXIT.launchFailed, `backend 启动失败：${cause.message}`),
      50
    );
  });
  backend.once("spawn", () => {
    if (backend.pid) {
      send({ v: 1, kind: "activated", nonce, backendPid: backend.pid });
    }
  });
  /* ============================================================
   * 死因原样传播：exit code 与 signal 都必须变成 guardian 自己的。
   * 上游 acp-turn 的归因内核（`exit` 拿死因、`close` 下判决）读的是 guardian
   * 的终态；这里若统一折成 exit(0)，四家 backend 的死因链就全断在 guardian
   * 这一层，用户只会看到一句零信息的 EOF。
   * ============================================================ */
  backend.once("exit", (code, signal) => {
    closing = true;
    socket.destroy();
    if (signal) {
      process.kill(process.pid, signal);
      // 该信号若被默认忽略（SIGCHLD 之流），仍要有确定的收口。
      setTimeout(() => process.exit(GUARDIAN_EXIT.protocol), 50);
      return;
    }
    process.exit(code ?? 0);
  });
}

function send(message: GuardianMessage) {
  if (closing || socket.destroyed) return;
  socket.write(encodeCustodyLine(message));
}
