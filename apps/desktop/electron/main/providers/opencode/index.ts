/**
 * [INPUT]: Depends on OpenCode CLI native ACP, the launch-environment external-override gate, model catalog, frozen third-party plus turn-leased built-in MCP overlay, AcpTurn and ACP failure classification
 * [OUTPUT]: Provides opencodeBackend, its minimum supported version, override validation against the spawn environment, authenticated local transport, permission modes, read-only tools, models with optional probe admission, provider-scoped auth checks and its Provider bridge readiness plan (behind the same override gate).
 * [POS]: The only installation point for the OpenCode descriptor; it stats but never reads or copies user/agent override configuration or credentials. Its turns are BridgedAcpTurns over this spawn config
 */

import { opencodeQuota } from "./quota";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OpencodeTurnOptions } from "../../../../shared/ipc/agent/agent-ipc";
import { npmLatestVersion } from "../../setup/latest-version";
import type { AcpSpawnConfig } from "../../backends/acp/launch";
import {
  commonCommandPaths,
  probeRuntimeCandidatesAsync,
  runtimeVersionAtLeast,
} from "../../backends/runtime/runtime-probe";
import type { BackendDescriptor, BackendTurnOptions } from "../../backends/types";
import { SESSION_CAPABILITY_POLICY } from "../../backends/acp/startup/client-capabilities";
import { createOpencodeAuthCheck } from "./auth";
import { opencodeClassifyFailure } from "./failure";
import {
  assertNoExternalOpencodeOverrides,
  opencodeAcpLaunch,
  opencodeEnvironment,
} from "./home";
import { opencodeTurnValues, validateOpencodeSessionId } from "./turn-config";
import { BridgedAcpTurn } from "../host/turns/bridged-turn";
import { requireProviderBridge } from "../host/runtime";
import {
  invalidateOpencodeModels,
  isOpencodeEffort,
  isOpencodeModelSlug,
  listOpencodeModels,
} from "./background/models";

const MINIMUM_VERSION = "1.18.13";
/* full-access 不进：那一档的语义是"卸掉围栏"，而本后端的 approve-for-me
   之所以敢放行 bash/edit，靠的恰恰是围栏还在。 */
const PERMISSIONS = new Set(["ask-for-approval", "approve-for-me"]);
const INSTALL_COMMAND = "curl -fsSL https://opencode.ai/install | bash";
/**
 * 官方安装器把二进制放进 `~/.opencode/bin` 并往 rc 文件追加 PATH——
 * 于是 GUI 进程继承到的 PATH 里恒无它（rc 只对之后启动的登录 shell 生效）。
 * 这条落点必须排在最前的回退里。
 *
 * 但 `commonPaths` 是**替换**语义：只写它就等于把 npm/bun/pnpm/homebrew
 * 那些通用落点全部丢掉，用另一种装法的机器反而探不到。显式取并集。
 */
const findOpencodeRuntime = (signal?: AbortSignal) =>
  probeRuntimeCandidatesAsync({
    command: "opencode",
    commonPaths: [
      join(homedir(), ".opencode/bin/opencode"),
      ...commonCommandPaths("opencode"),
    ],
    signal,
  });

function validate(value: unknown): asserts value is OpencodeTurnOptions {
  if (!value || typeof value !== "object") {
    throw new Error("OpenCode turn 选项不完整");
  }
  const options = value as Partial<OpencodeTurnOptions>;
  if (options.backend !== "opencode") {
    throw new Error("OpenCode 后端判别值无效");
  }
  if (
    options.model !== undefined &&
    (typeof options.model !== "string" || !isOpencodeModelSlug(options.model))
  ) {
    throw new Error("OpenCode 模型格式无效");
  }
  /* 只做形态校验：某个档位是否真属于当前模型，由 assertModelCapabilities
     拿可信目录判定——那才是唯一知道 variants 的地方。 */
  if (
    options.reasoningEffort !== undefined &&
    (typeof options.reasoningEffort !== "string" ||
      !isOpencodeEffort(options.reasoningEffort))
  ) {
    throw new Error("OpenCode Effort 格式无效");
  }
  /* 档位的值词表是**逐模型涌现**的（variants）。目录能用
     session/new 说清当下默认是谁，但「带 Effort 不带 model」仍不是
     一个稳定的 turn 合同：目录与发送之间默认可变，档位就会失去归属。
     renderer 在用户显式改 Effort 时会一并固化当前模型；这里继续 fail-close
     作为最后一道合同闸。 */
  if (options.reasoningEffort !== undefined && options.model === undefined) {
    throw new Error("OpenCode Effort 必须与模型一同指定");
  }
  if (!PERMISSIONS.has(options.permissionMode ?? "")) {
    throw new Error("OpenCode 权限档位无效");
  }
}

/**
 * spawn 配置独立成纯函数：它承载本接入案几乎全部的安全不变量
 * （锁定的监听参数、每 turn 随机凭据、ask 基线、两条 transport 开关），
 * 而这些不变量必须能在不真的起进程的前提下被断言。
 *
 * 「怎么起这个进程」那半边收在 home.ts 的 `opencodeAcpLaunch`：readiness
 * 探测必须消费同一份，两份必然漂移，而漂移的那一份正是安全基线。
 */
export function opencodeSpawnConfig(
  options: BackendTurnOptions
): AcpSpawnConfig {
  return {
    ...opencodeAcpLaunch(options.runtime, {
      processEnv: options.processEnv,
      /* 档位只经这一格数据进 env——`OPENCODE_PERMISSION` 的表在 home.ts，
         这里不复述任何一条规则。Plan 也走这里：它的另一半是 `modeValues`
         的 agent 切换，两半必须同一个 turn 一起生效。 */
      session: {
        approveForMe:
          options.payload.turnOptions.permissionMode === "approve-for-me",
        planMode: options.payload.planMode === true,
        thirdPartyMcpPlan: options.thirdPartyMcpPlan,
        builtinMcp: options.builtinMcp?.server,
      },
    }),
    ...opencodeTurnValues,
  };
}

export const opencodeBackend: BackendDescriptor = {
  id: "opencode",
  displayName: "OpenCode",
  minimumVersion: MINIMUM_VERSION,
  workspaceDirName: "opencode-workspace",
  sessionCapabilityPolicy: SESSION_CAPABILITY_POLICY.opencode,
  quota: opencodeQuota,
  detectRuntime: findOpencodeRuntime,
  // version 探针与 models/turn 同政策：CLI 模块加载即按 XDG 建目录，
  // 探针若用错位的环境，就会在另一处建目录、落缓存，与真实 turn 各说各话。
  versionEnvironment: opencodeEnvironment,
  validateRuntime: (runtime) =>
    runtimeVersionAtLeast(runtime.version, MINIMUM_VERSION)
      ? { status: "installed" }
      : {
          status: "unsupported",
          reason: `OpenCode 需要 ${MINIMUM_VERSION} 或更高版本。`,
        },
  auth: { check: createOpencodeAuthCheck(), turnEvidence: "provider" },
  readiness: async (runtime) => {
    /* The same external-override gate a turn passes, on the environment this readiness process gets (P6). */
    const launch = opencodeAcpLaunch(runtime, { session: {} });
    assertNoExternalOpencodeOverrides(launch.env);
    return { launch: { ...launch, cwd: homedir() } };
  },
  capabilitiesFor: () => ({
    resume: true,
    /* 两档。approve-for-me 的 UI 承诺是"放行安全动作、敏感请求仍然询问"，
       而上游的权限模型（逐键 allow/ask/deny + findLast）足以逐字兑现它：
       映射表在 home.ts，真机矩阵见 DEV/agents/docs/agent-cli-docs.md。 */
    permissionModes: ["ask-for-approval", "approve-for-me"],
    modelOptions: "list-only",
    imageInput: true,
    /* Plan 两半齐备才敢开：agent 切换（modeValues）负责换脑子，权限表的
       Plan 叠加负责堵住"换了脑子还是能改代码"——上游把我们注入的权限合并
       在 plan agent 自己的规则之后，只切 agent 是拦不住的。 */
    planMode: true,
    headless: [],
    maintenance: false,
    // OpenCode receives the product-owned read-only MCP through the same isolated
    // backend-config overlay already used for frozen third-party servers.
    builtinTools: "read",
  }),
  classifyFailure: opencodeClassifyFailure,
  // readiness 只证明 ACP 健康，单个 provider/model turn 也证明不了整个后端；
  // `turnEvidence:"provider"` 让 Registry 拒绝用最后一轮结果污染全局状态。
  validateTurnOptions: validate,
  validateSessionId: validateOpencodeSessionId,
  models: {
    list: (runtime, _workspace, signal, runProbe) =>
      listOpencodeModels(runtime, signal, runProbe),
    cached: (runtime) => listOpencodeModels.cached(runtime),
    invalidate: invalidateOpencodeModels,
  },
  createTurn: (options) => {
    validate(options.payload.turnOptions);
    /* 闸门判的必须是**这一次**要 spawn 的那份环境，不是宿主的 `process.env`：
       启动环境把 `XDG_CONFIG_HOME` 钉在 app-owned 空根上，按宿主判会让一份
       子进程根本读不到的 `~/.config/opencode/*` 否决全部 turn。 */
    const spawnConfig = opencodeSpawnConfig(options);
    assertNoExternalOpencodeOverrides(spawnConfig.env);
    /* Switched on, the launch (overlay and server credentials included) is sealed in main; the bridge gets only the values (C9, D2 5). */
    return new BridgedAcpTurn(options, spawnConfig, requireProviderBridge());
  },
  setup: {
    latestVersion: () => npmLatestVersion("opencode-ai"),
    selfUpdate: ["upgrade"],
    commands: {
      install: { command: INSTALL_COMMAND, dangerous: true },
      update: { command: "opencode upgrade", dangerous: true },
      login: { command: "opencode auth login", dangerous: false },
    },
  },
};
