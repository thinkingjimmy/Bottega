/**
 * [INPUT]: Depends on the string definition
 * [OUTPUT]: Provides create StderrNoiseFilter: By name list, remove known-quality CLI noise and its continuity, keep the state across the chunk
 * [POS]: The stderr noise reducer of the acp, which serves as the cause of death evidence (stderrTail); The only thing that is missing is the name of the noise, the rest of the words are silent
 */

/* ============================================================
 * 这张表的准入条件只有一条：**真机原文 + 已确认不影响 turn 终态**。
 *
 * 降噪的收益不是"日志好看"，而是 stderrTail 装得下真正的死因——它只有
 * ACP_STDERR_TAIL_BYTES 那么大，一次带栈的良性错误就能把真死因挤出去。
 * 代价则是：如果误收录一条没人认识的错误，我们会在事故当天失去唯一的
 * 线索。所以宁可留噪声，也不许凭"看起来像噪声"下手。
 * ============================================================ */
const BENIGN_HEADS = [
  /* Kimi 0.34.0 无条件 watch `$HOME`（chokidar），围栏内必得 EPERM。
     2026-08-07 真机原文：
       [unexpected] Error: EPERM: operation not permitted, watch '/Users/x'
       + 约 15 行 chokidar 栈帧与被打印的 error 对象。
     已确认进程存活、turn 正常结算（FSEvents mach 服务放行后不再自杀）。 */
  /^\[unexpected\] Error: EPERM: operation not permitted, watch /,
  /* claude-agent-acp 0.70.0 起每次 session/new 打一行会话诊断（0.62.0 零 stderr）。
     2026-08-27 真机原文：
       [session/query] sessionId=7f769909-… resume=none apiType=native baseUrl=native
     单行、无续行、与 turn 终态无关；不滤掉的话每建一个会话就吃掉一截
     ACP_STDERR_TAIL_BYTES，真死因会被这行例行公事挤出尾巴。 */
  /^\[session\/query\] sessionId=/,
  /* claude-agent-acp 0.70.0 收口路径：宿主对进程组发 SIGTERM（process-group.ts），
     CLI 以 143（128+SIGTERM）退出；SDK 0.3.232 把一切非零退出码包装成错误，
     适配器 shutdown 又同挂 connection.closed 与 SIGTERM 两个触发器且无幂等
     保护，同一句必打两遍。2026-08-28 真机原文：
       Error during cleanup: Error: Claude Code process exited with code 143
       + 约 9 行 SDK 栈帧与被打印的 error 对象（exitCode: 143）。
     已确认发生在 turn 判决之后——预期死亡的验尸噪音。判据钉死在 143 这一种
     死法：换个退出码的 cleanup 错误是待查线索，必须露出。 */
  /^Error during cleanup: Error: Claude Code process exited with code 143$/,
] as const;

/**
 * 续行判据：栈帧与被打印的 error 对象体是缩进的，对象闭合是顶格 `}`。
 * 只在「上一行已被判为良性」的状态里才丢——真错误的首行永远不匹配
 * BENIGN_HEADS，因此它的栈一行都不会进这个状态。
 */
const isContinuation = (line: string) =>
  line === "" || line === "}" || /^\s/.test(line);

export function createStderrNoiseFilter() {
  // 状态跨 chunk 保持：一个良性块完全可能被 pipe 切成两次 data 事件。
  let dropping = false;
  return (text: string) =>
    text
      .split("\n")
      .filter((line) => {
        if (BENIGN_HEADS.some((head) => head.test(line))) {
          dropping = true;
          return false;
        }
        if (dropping && isContinuation(line)) return false;
        dropping = false;
        return true;
      })
      .join("\n")
      .trim();
}
