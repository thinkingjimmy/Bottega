/**
 * [INPUT]: No external dependence
 * [OUTPUT]: Provides asError, errorMessage, withDeadline and statusError
 * [POS]: The single error vocabulary of Electron main; modules never re-declare their own status/http error constructors
 */

/** 任意抛出物归一为 Error，保持原始实例不丢栈。 */
export const asError = (cause: unknown) =>
  cause instanceof Error ? cause : new Error(String(cause));

/** 任意抛出物归一为用户可读文案。 */
export const errorMessage = (cause: unknown) => asError(cause).message;

/**
 * 带 HTTP 语义的错误只有这一个构造点；`extra` 承载 code/outcome 之类的判别字段，
 * 下游一律按结构判别，绝不靠文案正则认错误。
 */
export function statusError<Extra extends object = Record<never, never>>(
  status: number,
  message: string,
  extra: Extra = {} as Extra
) {
  return Object.assign(new Error(message), { status }, extra);
}

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
