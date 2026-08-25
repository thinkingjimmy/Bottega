/**
 * [INPUT]: Depends on startup/exit AcpExitReport and the descriptor budget coverage options
 * [OUTPUT]: Provides AcpStartupStep Budget Table, AcpStartupTracker, and the total budget is below the AcpStartupTimeout
 * [POS]: The only attributable core of the ACP launch chain; Transport only declares the sequence of steps, not the timers
 */

import { describeAcpExit, type AcpExitReport } from "./exit";

/* ============================================================
 * 启动链只有四步。
 *
 * 注意这里没有 "prompt"：AcpTurn 在 session/prompt **发出之后、结算
 * 之前** 就把 start() 兑现了（prompt 从不 await）。也就是说启动预算
 * 从来没有覆盖过「首 token」——编一个 prompt 步会让文案去承诺一件
 * 这套机制根本没在等的事。首 token 看门狗是另一件事，另案。
 * ============================================================ */
export type AcpStartupStep =
  | "spawn"
  | "custody"
  | "initialize"
  | "session"
  | "builtin-mcp";

export const ACP_STARTUP_BUDGET_MS: Record<AcpStartupStep, number> = {
  spawn: 5_000,
  custody: 10_000,
  initialize: 15_000,
  session: 20_000,
  "builtin-mcp": 15_000,
};

/** 每一步的失败话术：一张表取代一串 if——卡在哪一步，就说哪一步的话。 */
const STEP_HINT: Record<AcpStartupStep, string> = {
  spawn: "CLI 可执行文件未能启动",
  custody: "进程托管未就绪（guardian 未回报身份或未确认接收能力）",
  initialize: "CLI 未响应 ACP initialize，请检查安装与登录状态",
  session: "CLI 未能创建会话，请检查登录状态",
  "builtin-mcp": "内置工具服务未就绪（MCP 子进程未连回主进程）",
};

type AcpStepTiming = { step: AcpStartupStep; ms: number };

export type AcpStartupBudget = Partial<Record<AcpStartupStep, number>>;

const formatTimeline = (timeline: AcpStepTiming[]) =>
  timeline
    .map((entry) => `${entry.step} ${(entry.ms / 1000).toFixed(1)}s`)
    .join(" → ");

/** 已完成步骤的耗时清单渲染成后缀；首步就超时时不留空括号。 */
const timelineSuffix = (timeline: AcpStepTiming[]) =>
  timeline.length ? `；${formatTimeline(timeline)}` : "";

export class AcpStartupTimeout extends Error {
  constructor(
    readonly step: AcpStartupStep,
    readonly budgetMs: number,
    readonly timeline: AcpStepTiming[]
  ) {
    super(
      `${STEP_HINT[step]}（步骤 ${step} 超过 ${Math.round(
        budgetMs / 1000
      )}s${timelineSuffix(timeline)}）`
    );
  }
}

export class AcpStartupExit extends Error {
  constructor(
    readonly step: AcpStartupStep,
    readonly exit: AcpExitReport,
    readonly timeline: AcpStepTiming[]
  ) {
    super(
      `${describeAcpExit(exit)}（步骤 ${step}${timelineSuffix(timeline)}）`
    );
  }
}

export class AcpStartupTracker {
  readonly timeline: AcpStepTiming[] = [];

  constructor(
    private readonly exited: Promise<AcpExitReport>,
    private readonly budget: AcpStartupBudget = {},
    private readonly now: () => number = Date.now
  ) {}

  /**
   * 唯一的计时/归因原语：任务 / 本步 deadline / 子进程退出 三条腿 race。
   *
   * 调用点只提供步名与任务，不认识任何计时器——新增一步等于表里加一行
   * 数据，而不是加一个分支。子进程退出恒先手，所以启动期永远拿得到
   * exit code 与 stderr，而不是 SDK 那句无信息的 EOF。
   */
  async run<T>(step: AcpStartupStep, task: () => Promise<T>): Promise<T> {
    const budgetMs = this.budget[step] ?? ACP_STARTUP_BUDGET_MS[step];
    const started = this.now();
    let handle: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      handle = setTimeout(
        () => reject(new AcpStartupTimeout(step, budgetMs, [...this.timeline])),
        budgetMs
      );
      handle.unref?.();
    });
    const died = this.exited.then((report) => {
      throw new AcpStartupExit(step, report, [...this.timeline]);
    });
    try {
      const value = await Promise.race([task(), deadline, died]);
      this.timeline.push({ step, ms: this.now() - started });
      return value;
    } finally {
      if (handle) clearTimeout(handle);
      /* died 是 exited 的派生 promise：exited 永不 reject（只在 close 时
         resolve），但派生出来的这个一定会 throw。没人接住就是
         unhandledRejection——本步已经结算，这里主动收尾。 */
      died.catch(() => undefined);
    }
  }
}

/**
 * 总预算兜底 = Σ 各步预算 + 余量。
 * 只用于「AcpTurn 自己没结算」这类内部 bug；正常路径永远由分步预算先命中。
 */
export function acpStartupBackstopMs(budget: AcpStartupBudget = {}) {
  const total = (
    Object.keys(ACP_STARTUP_BUDGET_MS) as AcpStartupStep[]
  ).reduce(
    (sum, step) => sum + (budget[step] ?? ACP_STARTUP_BUDGET_MS[step]),
    0
  );
  return total + 10_000;
}
