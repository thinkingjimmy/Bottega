/**
 * [INPUT]: Depends on PromptInput The order of the synchronized call for the event is the lifecycle of AbortSignal
 * [OUTPUT]: Provides synchronous submission of prohibited access, abortion checks and interruptible step-by-step instructions
 * [POS]: The unified kernel of ui/lib is submitted simultaneously; View projection busy, runtime repeat the same stop-loss meaning hold the wait boundary
 */

export class PromptInputSubmissionGate {
  private active = false;

  tryEnter() {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  leave() {
    this.active = false;
  }

  isActive() {
    return this.active;
  }
}

function abortError(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("提交生命周期已结束");
  error.name = "AbortError";
  return error;
}

export function throwIfSubmissionAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortError(signal);
}

export function awaitSubmissionStep<T>(
  signal: AbortSignal,
  step: () => T | PromiseLike<T>
): Promise<T> {
  throwIfSubmissionAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void Promise.resolve()
      .then(() => {
        throwIfSubmissionAborted(signal);
        return step();
      })
      .then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          if (signal.aborted) reject(abortError(signal));
          else resolve(value);
        },
        (cause) => {
          signal.removeEventListener("abort", onAbort);
          reject(cause);
        }
      );
    if (signal.aborted) onAbort();
  });
}
