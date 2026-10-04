/**
 * [INPUT]: Depends on the OpenCode failure classifier and the ACP spawn config type
 * [OUTPUT]: Provides validateOpencodeSessionId and opencodeTurnValues, the launch-independent half of the OpenCode ACP turn config
 * [POS]: Shared by the in-process OpenCode turn (providers/opencode/index.ts) and the OpenCode Provider bridge; the launch half (command, args, the environment with the MCP overlay and the server credentials) is built only in main by `opencodeAcpLaunch`, and nothing here may import it: the bridge must not carry the runtime port or see those secrets
 */
import type { AcpSpawnConfig } from "../../backends/acp/launch";
import { opencodeClassifyFailure } from "./failure";

/* 真机 1.18.14：`ses_` + 恰 26 位（12 位时间戳 + 14 位 base62）。 */
const SESSION_PATTERN = /^ses_[0-9A-Za-z]{26}$/;

export const validateOpencodeSessionId = (id: string) => SESSION_PATTERN.test(id);

export const opencodeTurnValues = {
  validateSessionId: validateOpencodeSessionId,
  resumeWithoutReplay: true,
  /* No `sessionMissing`: upstream folds "no such session" and a storage fault into the same -32603, so any text matcher would
     misread one as the other (a broken store silently becoming a new session). A failed resume surfaces as an error. */
  /* "always" 在上游只是服务进程内存里的一个数组，进程退出即失。
     每 turn 一进程 ⇒ 它兑现不了「本会话总是允许」，于是不给这个选项。 */
  suppressAlwaysApprovalOptions: true,
  thirdPartyMcpTransport: "backend-config",
  builtinMcpTransport: "backend-config",
  classifyFailure: opencodeClassifyFailure,
  /* ============================================================
   * Plan = 切 agent。上游把 primary agent 直接摆在 ACP 的 `mode`
   * 配置项里：`values: ["build","plan"]`、`currentValue` = 用户的
   * primary（实测）。
   *
   * `default: "build"` 是一条**有意的**产品选择而非疏忽：非 plan 轮必须
   * 显式切回去，因为实测 mode **跨进程 resume 仍然残留**——一个进过 plan
   * 的会话若"不动它"，就永远停在 plan 里，而 UI 上的开关早已关掉。代价是
   * 用户的 `default_agent`（自定义 primary）在本产品里不生效：Plan 开关
   * **就是**本产品的 mode 选择器，认一个它表达不了的第三种 agent，等于让
   * 开关说一句不算数的话。用户真把 build 禁掉时，`modeConfig` 当场抛
   * 「后端拒绝了当前工作模式」——响亮地错，而不是悄悄跑错 agent。
   *
   * approve-for-me 不换 agent（它整个由权限表表达），故与 default 同值。
   * ============================================================ */
  modeValues: { default: "build", plan: "plan", approveForMe: "build" },
} as const satisfies Omit<AcpSpawnConfig, "command" | "args" | "env">;
