/**
 * [INPUT]: Depends on nothing.
 * [OUTPUT]: Provides WORKER_RESOURCE_LIMITS, the `resourceLimits` every main-owned `new Worker` passes.
 * [POS]: The single worker-isolate sizing policy for the main process; the four worker clients (Chat SQLite, history import, App GUI query, sync crypto) read it and declare no budget of their own.
 */

/* ── 新生代不该按主 isolate 的身材裁 ──────────────────────────────
 * worker 线程默认继承主 isolate 的新生代半区（本机约 16 MB）。可这四条
 * 线程全是「收一条请求、算完、回一条」的形态：分配峰值由一批 SQLite 行或
 * 一次 KDF 决定，与主进程的 UI 分配模式毫无关系。代价是实测里聊天 worker
 * 已提交堆的三成是一块从不被填满的新生代。
 *
 * 取值 8 而不是 4：20 万条源的 sqlite-performance 导入基准里，4 MB 的尾延迟
 * 在两次运行中都更差（batch-roundtrip p95 660/384 ms、transaction max
 * 1537/935 ms），8 MB 是 348/236 ms 与 417/476 ms；16 MB 与 8 MB 的耗时无可测
 * 差异，但空闲已提交堆更高（22.8 vs 22.3 MB，4 MB 为 18.6 MB）。取「没有可测
 * 延迟回退的最小值」即 8。老生代上限不动——真正的大对象仍然要能装下。
 * ────────────────────────────────────────────────────────────── */
export const WORKER_RESOURCE_LIMITS = { maxYoungGenerationSizeMb: 8 } as const;
