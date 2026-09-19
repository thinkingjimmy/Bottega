/**
 * [INPUT]: Depends on AcpConnection request delegation
 * [OUTPUT]: Provides pingAcpConnection — the `session/list` liveness probe the pool runs after a wake
 * [POS]: The only liveness judgement in backends/connections; the pool decides what to do with a failure, never how to ask
 */

import type { AcpConnection } from "../acp/connection/acp-connection";

/** 唯一真正穿到 CLI 进程的候选：`set_config_option` / `set_mode` 在 Codex 由
    adapter 内存应答，在 Kimi/OpenCode 还会产生多余 `session/update`（PRD §6.5）。 */
const PING_METHOD = "session/list";
const PING_TIMEOUT_MS = 5_000;

export async function pingAcpConnection(
  connection: AcpConnection,
  timeoutMs = PING_TIMEOUT_MS
) {
  if (connection.dead) throw new Error("ACP 连接已死");
  let handle: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    handle = setTimeout(
      () => reject(new Error(`ACP 连接 ${PING_METHOD} 未在 ${timeoutMs}ms 内应答`)),
      timeoutMs
    );
    handle.unref?.();
  });
  try {
    await Promise.race([connection.request(PING_METHOD, {}), deadline]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}
