/**
 * [INPUT]: No external dependence
 * [OUTPUT]: Provides asError (for example, in the following example:
 * [POS]: The Error of Electron main was the only source, replacing the instance of Error of the three-mode copy of each module
 */

/** 任意抛出物归一为 Error，保持原始实例不丢栈。 */
export const asError = (cause: unknown) =>
  cause instanceof Error ? cause : new Error(String(cause));

/** 任意抛出物归一为用户可读文案。 */
export const errorMessage = (cause: unknown) => asError(cause).message;

/**
 * 给一个 promise 加上兜底期限；到期用 `expire()` 造因并拒绝。
 * 计时器 unref：退出时不许一个残留 timer 吊住进程。
 */
export function withDeadline<T>(
  task: Promise<T>,
  ms: number,
  expire: () => Error
): Promise<T> {
  let handle: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    handle = setTimeout(() => reject(expire()), ms);
    handle.unref?.();
  });
  return Promise.race([task, deadline]).finally(() => {
    if (handle) clearTimeout(handle);
  });
}
