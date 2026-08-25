/**
 * [INPUT]: No external dependence
 * [OUTPUT]: Provides errorMessage (i.e. the message is reported as a user-readable text file and the machine code prefix is removed from the main) and reportedFailure/isReportedFailure (i.e. whether the failure has been explained above)
 * [POS]: The only source of Error in the renderer is the instance of Error, a three-dimensional copy of the component layer handwritten by the substitute
 */

/* ── 码归日志，人话归人 ────────────────────────────────────────────
 * main 的断言写成 `CODE: 人话`：前半段是给日志与分支判定的坐标，后半段
 * 才是给用户的解释。以前两段一起端上桌，用户读到的是
 * 「CHAT_HOME_NOT_READY: 请先…」——一半措辞不是写给他的。
 * 与其让每个视图各自记得剥一次，不如在归一处剥净：能消失的分支，
 * 永远比处处都写对的分支更可靠。锚定行首，正文里的大写词不受牵连。
 * ────────────────────────────────────────────────────────────── */
const MACHINE_CODE = /^[A-Z][A-Z0-9_]{3,}:\s*/;

/* ── IPC 通道名也是坐标，不是人话 ──────────────────────────────────
 * Electron 把通道名与远端栈一起拼进 message：
 * `Error invoking remote method 'extensions:preflight': Error: 仅支持…`。
 * 通道名对用户毫无意义，而它出现在**每一条**穿过 IPC 的错误上——这正是
 * 「在归一处剥净」的典型对象。剥完再走 MACHINE_CODE，两层坐标一并落地。
 * ────────────────────────────────────────────────────────────── */
const IPC_ENVELOPE = /^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/;

/** 任意抛出物归一为用户可读文案；非 Error 或剥完只剩空串时使用 fallback。 */
export const errorMessage = (cause: unknown, fallback?: string) => {
  const stripped = (cause instanceof Error ? cause.message : fallback ?? String(cause))
    .replace(IPC_ENVELOPE, "")
    .replace(MACHINE_CODE, "")
    .trim();
  /* 剥完为空是真实存在的：只有信封没有正文的 Error。此时端一个空字符串上桌
     等于什么都没说——兜底属于归一处，不该由每个调用点各写一次 `|| "…"`。 */
  return stripped || fallback || "";
};

/* ── 一次失败只该被解释一次 ────────────────────────────────────────
 * 提交事务已把病因写进 transcript 时，PromptInput 的兜底通道若照抄一遍，
 * 用户会在卡片与输入框上读到同一句话。标记挂在抛出物上而非另开返回通道：
 * throw 仍是保住草稿的唯一手段，不能为了闭嘴而咽掉它。
 * ────────────────────────────────────────────────────────────── */
const REPORTED = Symbol("failure-reported");

/** 标记「此失败已向用户解释过」，兜底通道据此跳过重复提示。 */
export const reportedFailure = (cause: unknown) =>
  Object.assign(cause instanceof Error ? cause : new Error(String(cause)), {
    [REPORTED]: true,
  });

/** 抛出物是否已被上游解释过。 */
export const isReportedFailure = (cause: unknown) =>
  typeof cause === "object" && cause !== null && REPORTED in cause;
