/**
 * [INPUT]: Depends on AbortSignal, Browser debugger/webContents seam and the pending action Promise
 * [OUTPUT]: Provides deadlineSignal and runCancelableAction; Stop JS/Navigation and wait for the bottom command to settle
 * [POS]: The main/browser/execution action is to delete the kernel; Concentrated load timeout, CDP cancel and detach bottom, not explaining business movements
 */

import { setTimeout as delay } from "node:timers/promises";
import type {
  BrowserDebuggerPort,
  BrowserWebContentsPort,
} from "../browser-service";

const CANCEL_GRACE_MS = 500;

type CancellationTarget = {
  debuggerPort: BrowserDebuggerPort;
  contents: BrowserWebContentsPort;
  sessionIds: readonly (string | undefined)[];
};

export function deadlineSignal(upstream: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const forward = () => controller.abort(upstream.reason);
  if (upstream.aborted) forward();
  else upstream.addEventListener("abort", forward, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("浏览器动作超时", "TimeoutError")),
    timeoutMs
  );
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      upstream.removeEventListener("abort", forward);
    },
  };
}

export async function runCancelableAction<T>(input: {
  run(): Promise<T>;
  timeoutMs: number;
  upstream: AbortSignal;
  target: CancellationTarget;
}) {
  const timed = deadlineSignal(input.upstream, input.timeoutMs);
  let aborted = false;
  let abortReason: unknown;
  let abortTask: Promise<void> | undefined;
  const action = Promise.resolve().then(() => {
    timed.signal.throwIfAborted();
    return input.run();
  });
  const guarded = action.then(
    async (value) => {
      if (aborted) {
        await abortTask;
        throw abortReason;
      }
      return value;
    },
    async (cause) => {
      if (aborted) {
        await abortTask;
        throw abortReason;
      }
      throw cause;
    }
  );
  const onAbort = () => {
    aborted = true;
    abortReason = timed.signal.reason;
    abortTask ??= cancelAndSettle(action, input.target);
  };
  if (timed.signal.aborted) onAbort();
  else timed.signal.addEventListener("abort", onAbort, { once: true });

  try {
    return await Promise.race([
      guarded,
      waitForAbort(timed.signal).then(async () => {
        onAbort();
        await abortTask;
        throw abortReason;
      }),
    ]);
  } finally {
    timed.signal.removeEventListener("abort", onAbort);
    timed.dispose();
  }
}

async function cancelAndSettle(
  action: Promise<unknown>,
  target: CancellationTarget
) {
  try {
    target.contents.stop();
  } catch {
    // 页面已销毁时 stop 是自然 no-op；debugger detach 仍负责结算命令。
  }
  const sessions = [...new Set(target.sessionIds)];
  const cancellation = Promise.allSettled([
    safeCommand(target.debuggerPort, "Page.stopLoading"),
    ...sessions.map((sessionId) =>
      safeCommand(
        target.debuggerPort,
        "Runtime.terminateExecution",
        {},
        sessionId
      )
    ),
  ]);
  const settled = Promise.allSettled([action, cancellation]);
  const completed = await Promise.race([
    settled.then(() => true),
    delay(CANCEL_GRACE_MS).then(() => false),
  ]);
  if (!completed && target.debuggerPort.isAttached()) {
    try {
      target.debuggerPort.detach();
    } catch {
      // detach 失败时仍等待原命令结算，绝不提前宣告 stopped。
    }
  }
  await settled;
}

function safeCommand(
  debuggerPort: BrowserDebuggerPort,
  method: string,
  params?: Record<string, unknown>,
  sessionId?: string
) {
  return Promise.resolve().then(() =>
    debuggerPort.sendCommand(method, params, sessionId)
  );
}

function waitForAbort(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
