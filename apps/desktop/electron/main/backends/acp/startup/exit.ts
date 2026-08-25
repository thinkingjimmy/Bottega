/**
 * [INPUT]: Depends on Node ChildProcess exit event, transport EOF is bounded by the real-time stderr tail
 * [OUTPUT]: Provides AcpExitReport, describes AcpExit, isTransportEof and preferProcessExit
 * [POS]: The only source of truth about the cause of death in the ACP sub-process; The SDK does not include the "ACP connection closed" as the final file
 */

export type AcpExitReport = {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** exit 与 stderr 管道独立，函数形态允许消费者在真正结算时读取迟到尾巴。 */
  stderrTail: string | (() => string);
};

export type PreferProcessExitOptions = {
  graceMs?: number;
  /** 结算时再读取：stdout EOF 与 stderr 是独立管道，尾巴可能在宽限期内迟到。 */
  stderrTail?: () => string;
};

/* ============================================================
 * transport 级 EOF：子进程 stdout 关闭后，SDK 会把所有在飞请求以
 * 一句固定文案拒掉（vendored jsonrpc.js 的 Connection.close）。
 * 这句话不含 exit code、不含 stderr，对诊断价值为零——它出现时
 * 真正的死因一定在紧随其后的 close 事件里。
 * ============================================================ */
const TRANSPORT_EOF_MESSAGES = new Set([
  "ACP connection closed",
  "Connection closed",
]);

export function isTransportEof(cause: unknown) {
  const message =
    cause instanceof Error
      ? cause.message
      : typeof (cause as { message?: unknown })?.message === "string"
        ? ((cause as { message: string }).message)
        : "";
  return TRANSPORT_EOF_MESSAGES.has(message.trim());
}

export function describeAcpExit(report: AcpExitReport) {
  const head = `ACP 子进程提前退出（code=${report.code ?? "null"}, signal=${
    report.signal ?? "null"
  }）`;
  const tail = (
    typeof report.stderrTail === "function"
      ? report.stderrTail()
      : report.stderrTail
  ).trim();
  return tail ? `${head}：${tail}` : head;
}

function describeTransportEof(graceMs: number, stderrTail: string) {
  const head = `ACP transport 提前关闭（${graceMs}ms 内未收到进程退出状态）`;
  const tail = stderrTail.trim();
  return tail ? `${head}：${tail}` : head;
}

/**
 * 非启动期的让位：EOF 类原因先等一个 close 窗口，拿到 code/stderr 再结算。
 *
 * 启动期不需要它——AcpStartupTracker 的第三条腿已经让进程退出恒先手；
 * 这里管的是 prompt 结算之后那段，届时 tracker 早已退场。
 */
export async function preferProcessExit(
  cause: unknown,
  exited: Promise<AcpExitReport>,
  options: PreferProcessExitOptions = {}
): Promise<unknown> {
  if (!isTransportEof(cause)) return cause;
  const graceMs = options.graceMs ?? 300;
  const timer = new Promise<undefined>((resolve) => {
    const handle = setTimeout(() => resolve(undefined), graceMs);
    handle.unref?.();
  });
  const report = await Promise.race([exited, timer]);
  if (report) return new Error(describeAcpExit(report));
  return new Error(
    describeTransportEof(graceMs, options.stderrTail?.() ?? "")
  );
}
