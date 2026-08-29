/**
 * [INPUT]: Depends on Registry first-valid flight Kimi CLI candidates/ACP, provider model/Thinking, authorized processEnv, installer, headless/maintenance, buildtinTools oracle and system Skill root
 * [OUTPUT]: Provides kimiBackend: Unified ACP Chat, authorization environment, models, images, Plan, version control tools, runtime discovery and background extensions
 * [POS]: The only installation point for the Kimi descriptor; When running, the registry is handing over the rights and capabilities
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { KimiTurnOptions } from "../../../../shared/agent-ipc";
import { systemSkillsPath } from "../../system-skills";
import { githubLatestVersion } from "../../setup/latest-version";
import { AcpTurn } from "../acp/acp-turn";
import { classifyAcpFailure } from "../acp/failure";
import {
  MODEL_ID_PATTERN,
  OPAQUE_CONFIG_VALUE_PATTERN,
} from "../capability-validation";
import {
  builtinToolsForVersion,
  commonCommandPaths,
  probeRuntimeCandidatesAsync,
  runtimeVersionAtLeast,
} from "../runtime-probe";
import type { BackendDescriptor } from "../types";
import { SESSION_CAPABILITY_POLICY } from "../acp/session/client-capabilities";
import { invalidateKimiModels, listKimiModels } from "./models";
import {
  kimiAcpLaunch,
  kimiEnvironment,
  resolveKimiCodeHome,
  validateKimiSessionId,
} from "./home";
import { createKimiAuthCheck } from "./auth";

const PERMISSIONS = new Set(["ask-for-approval", "approve-for-me"]);
const MINIMUM_VERSION = "0.29.1";
const INSTALL_COMMAND =
  "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash";
export function kimiSkillSources(
  workspace: string,
  systemPath = systemSkillsPath(),
  userHome = homedir(),
  codeHome = resolveKimiCodeHome()
) {
  return [
    { path: join(userHome, ".agents", "skills"), scope: "user" as const },
    { path: join(codeHome, "skills"), scope: "user" as const },
    { path: join(workspace, ".agents", "skills"), scope: "repo" as const },
    { path: join(workspace, ".kimi-code", "skills"), scope: "repo" as const },
    { path: systemPath, scope: "system" as const },
  ];
}

/**
 * Kimi 官方安装器把二进制放进 `~/.kimi-code/bin`，而 GUI 进程继承的 PATH
 * 里没有它——本机能探到全靠登录 shell 那一跳兜住。打包 .app 从 Finder
 * 启动、登录 shell 探测失败时，Kimi 直接不可见。
 *
 * `commonPaths` 是**替换**语义：只写这一条等于把 npm/bun/pnpm/homebrew
 * 那些通用落点全丢掉，用别种装法的机器反而探不到。显式取并集
 * （与 OpenCode 同型，见 opencode/index.ts）。
 */
const findKimiRuntime = (signal?: AbortSignal) =>
  probeRuntimeCandidatesAsync({
    command: "kimi",
    commonPaths: [
      join(homedir(), ".kimi-code/bin/kimi"),
      ...commonCommandPaths("kimi"),
    ],
    signal,
  });

function validate(value: unknown): asserts value is KimiTurnOptions {
  if (!value || typeof value !== "object") {
    throw new Error("Kimi turn 选项不完整");
  }
  const options = value as Partial<KimiTurnOptions>;
  if (options.backend !== "kimi") throw new Error("Kimi 后端判别值无效");
  if (
    options.model !== undefined &&
    (typeof options.model !== "string" || !MODEL_ID_PATTERN.test(options.model))
  ) {
    throw new Error("Kimi 模型格式无效");
  }
  if (
    options.reasoningEffort !== undefined &&
    (typeof options.reasoningEffort !== "string" ||
      !OPAQUE_CONFIG_VALUE_PATTERN.test(options.reasoningEffort))
  ) {
    throw new Error("Kimi Thinking Effort 格式无效");
  }
  if (!PERMISSIONS.has(options.permissionMode ?? "")) {
    throw new Error("Kimi 权限档位无效");
  }
}

// builtinTools 由 oracle 按 runtime 版本推导：实测解锁版 **≥0.39.0** 为 mutate
// （0.37.0–0.38.x 是上游 stdio MCP 坏窗口，PR #3183 在 0.39.0 修复；旧下界
// 0.29.2 因此作废），最低支持版 0.29.1 保持 none（fail-closed 语义不破坏）。
const capabilities: Omit<
  ReturnType<BackendDescriptor["capabilitiesFor"]>,
  "builtinTools"
> = {
  resume: true,
  permissionModes: ["ask-for-approval", "approve-for-me"],
  modelOptions: "list-only",
  imageInput: true,
  planMode: true,
  /* ============================================================
   * headless / maintenance 声明**已清空**（2026-08-27 用户裁决）。
   *
   * 事实：kimi 用 chokidar **无条件 watch `$HOME`**，而 headless 围栏的
   * `file-read*` 不含 `$HOME` ⇒ 必得 EPERM，且该 `'error'` 上游**未挂
   * listener** ⇒ 未捕获异常 ⇒ 进程在 1–7s 的启动期自杀。五项
   * （title/install-analysis/repair/serve/subagent）在 0.38.0 与 0.39.0
   * 上各跑一轮，**0/5，无一项到达模型**。
   *
   * **这不是版本回归，是长期假声明**：08-07 对 0.34.0 的取证行已记着同一
   * 条 EPERM 与同一种死法，且围栏相关面自那时起逐字未动（放行
   * `com.apple.FSEvents` 治的是 EMFILE 那一半；08-07 的 seatbelt 注释就
   * 写明「file-read* 的 deny 一行未动 ⇒ CLI 去 watch 主目录照样 EPERM，
   * 那正是围栏该说的『不』」）。⇒ 产品从来没在围栏下跑通过这五项，先前
   * 的声明是**产品欠用户的一句实话**，不是上游欠我们的能力。
   *
   * maintenance 一并落 false：install-analysis/repair/serve **本就是三个
   * headless purpose**，headless 死则它们死；只清一半会让 App 流程在更深
   * 的层次失败，那是 fail-late 不是 fail-closed。
   *
   * **代码保留待解锁**：`./headless.ts`（含已注入的官方开关
   * `KIMI_DISABLE_OAUTH_LOCK=1`）与 `./maintenance.ts` **不删**，仍由
   * `__tests__/kimi-headless-spec.test.ts` 直接覆盖，不会静默腐烂。
   * **解锁 = 两步、零阻力**：① 恢复本处 `headless`/`maintenance` 两行；
   * ② 恢复 descriptor 末尾的 `headless:{purposes,spec}` 与 `maintenance`
   * 两块（连同 `./headless`、`./maintenance` 两条 import）。
   * **解锁条件（两个都要）**：上游让 watch 的 EPERM 不再致命（挂 error
   * listener / 降级重试，参照它交互面已有的存活行为）**且**真机五项回归全绿。
   * 取证与裁决见真值账 §一 2026-08-27「kimi 0.39.0 升级修复验证」与
   * 「kimi headless 声明清空」两行。
   * ============================================================ */
  headless: [],
  maintenance: false,
};

export const kimiBackend: BackendDescriptor = {
  id: "kimi",
  displayName: "Kimi",
  workspaceDirName: "kimi-workspace",
  sessionCapabilityPolicy: SESSION_CAPABILITY_POLICY.kimi,
  detectRuntime: findKimiRuntime,
  // version 探针与 models/turn 同政策：KIMI_CODE_HOME 随 env 漂移时，
  // 探针必须落在同一状态根，否则会在错位目录建目录、落缓存。
  versionEnvironment: kimiEnvironment,
  validateRuntime: (runtime) =>
    runtimeVersionAtLeast(runtime.version, MINIMUM_VERSION)
      ? { status: "installed" }
      : {
          status: "unsupported",
          reason: `Kimi Code 需要 ${MINIMUM_VERSION} 或更高版本。`,
        },
  capabilitiesFor: (runtime) => ({
    ...capabilities,
    builtinTools: builtinToolsForVersion("kimi", runtime.version),
  }),
  classifyFailure: classifyAcpFailure,
  auth: { check: createKimiAuthCheck() },
  validateTurnOptions: validate,
  validateSessionId: validateKimiSessionId,
  models: {
    /* The adapter is catalog-driven and already carries multiple Effort values.
       Current Kimi model rows simply do not declare `support_efforts`; when
       upstream does, the existing list-only selector unlocks with zero code. */
    list: (runtime, _workspace, signal) => listKimiModels(runtime, signal),
    invalidate: invalidateKimiModels,
  },
  createTurn: (options) => {
    validate(options.payload.turnOptions);
    return new AcpTurn(options, {
      ...kimiAcpLaunch(options.runtime, { processEnv: options.processEnv }),
      validateSessionId: validateKimiSessionId,
      resumeWithoutReplay: true,
      /* `auto` is deliberately absent: unlike yolo it also suppresses the
         question channel, silently collapsing a third axis into the permission
         selector and breaking the shared four-backend meaning. Unlock only
         when the product owns an explicit cross-backend Silent Mode axis (L7). */
      modeValues: {
        default: "default",
        plan: "plan",
        approveForMe: "yolo",
      },
      classifyFailure: kimiBackend.classifyFailure,
      reviewResidualApprovals: true,
    });
  },
  skills: { sources: kimiSkillSources },
  setup: {
    latestVersion: () => githubLatestVersion("MoonshotAI/kimi-code"),
    commands: {
      install: {
        command: INSTALL_COMMAND,
        dangerous: true,
      },
      update: {
        command: INSTALL_COMMAND,
        dangerous: true,
      },
      login: { command: "kimi", dangerous: false },
    },
  },
  /* headless / maintenance 两块随声明一起清空——理由、代码保留策略与
     两步解锁路径见上方 capabilities 处的注释。opencode 是同形先例：
     它同样只是「不声明」，而不是把 spec 代码删掉。 */
};
