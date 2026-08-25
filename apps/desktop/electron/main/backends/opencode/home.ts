/**
 * [INPUT]: Depends on Node crypto/os/path, runtime-probe Minimum user environment, XDG/OPENCODE_* User variables with main Freeze third-party MCP plan
 * [OUTPUT]: Provides opencodeEnvironment ((variable pass/drop/override)  global AGENTS.md alternative semantics config dir, opencodeRoots/opencodeSensitiveFiles Fence data source, sessionId validator, each turn random server credentials, refusing to repeat alias with unaltered OPENCODE_CONFIG_CONTENT MCP overlay and locked listening + key-by-key permissions with overlapping Plan opencodepLaunchAc
 * [POS]: The environment and state root of backends/opencode is a single source of truth; version/models/turn Three paths share the same policy, sandbox declaration table takes path from here
 */

import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sanitizedProcessEnvironment } from "../runtime-probe";
import type { AcpLauncher, AgentRuntime } from "../types";
import {
  assertUniqueMcpBackendAliases,
  type ThirdPartyMcpPlan,
} from "../../../../shared/mcp-servers-ipc";

/* 真机 1.18.14：`ses_` + 恰 26 位（12 位时间戳 + 14 位 base62）。 */
const SESSION_PATTERN = /^ses_[0-9A-Za-z]{26}$/;

export const validateOpencodeSessionId = (id: string) =>
  SESSION_PATTERN.test(id);

/* ============================================================
 * 环境是一张显式的逐变量表，不是「继承 process.env 再删几个」。
 *
 * pass   —— 用户对自己 CLI 的配置选择，app 原样带上（含收紧开关）；
 * drop   —— 白名单之外一律不透传，provider key 尤其不经本进程之手；
 * override —— 三条安全不变量，用户设了也压过去：
 *   OPENCODE_PURE 清空 plugin_origins（否则全局 config 声明的第三方
 *   插件会被安装并执行——`OPENCODE_DISABLE_PROJECT_CONFIG` 只挡从工
 *   作目录向上扫的那一段，全局 config 恒扫，挡不住）；
 *   DISABLE_PROJECT_CONFIG 断掉项目携带 allow-all 权限的旁路；
 *   DISABLE_LSP_DOWNLOAD / DISABLE_EXTERNAL_SKILLS 让探针与 turn
 *   不在用户不知情时下载和执行外部代码。
 *
 * 布尔值一律写 "1"：上游两套 flag 解析器中较严的那套只认
 * "true"/"1"（小写化后），yes/on 会被静默当成 false。
 * ============================================================ */
const PASS_THROUGH = [
  "OPENCODE_DISABLE_DEFAULT_PLUGINS",
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
] as const;

const OVERRIDES = {
  OPENCODE_PURE: "1",
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
  OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
} as const;

export function opencodeEnvironment(
  runtime: AgentRuntime,
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const passed = Object.fromEntries(
    PASS_THROUGH.flatMap((name) => {
      const value = source[name]?.trim();
      return value ? [[name, value] as const] : [];
    })
  );
  return {
    ...sanitizedProcessEnvironment(runtime.path, source),
    ...passed,
    ...OVERRIDES,
  };
}

const xdgRoot = (
  env: NodeJS.ProcessEnv,
  name: string,
  userHome: string,
  fallback: string
) => resolve(env[name]?.trim() || join(userHome, fallback));

/**
 * 全局 AGENTS.md 归属是替换语义：OPENCODE_CONFIG_DIR 一旦给出就直接
 * 成为目标，否则才落 XDG_CONFIG_HOME/opencode。它刻意不复用
 * opencodeRoots：配置扫描根是 additive，指令文件却只有一个 owner。
 */
export function opencodeConfigDir(
  env: NodeJS.ProcessEnv,
  userHome: string
) {
  return resolve(
    env.OPENCODE_CONFIG_DIR?.trim() ||
      join(xdgRoot(env, "XDG_CONFIG_HOME", userHome, ".config"), "opencode")
  );
}

/**
 * OpenCode 的状态根全集。模块加载即 mkdir 七目录（data/config/state/
 * tmp/log/bin/repos，`--version` 也触发），全部落在下面五个根之内——
 * 写面是 deny-by-default，漏一根就是"围栏内摔死"，所以宁可多列。
 *
 * 同一个函数服务两个视角：传子进程 env 得到自己的可写根，传宿主 env
 * 与空 env 的并集得到异后端要拒的根（用户改过 XDG 时旧目录也照拒）。
 */
export function opencodeRoots(
  env: NodeJS.ProcessEnv,
  userHome: string
): string[] {
  return [
    join(xdgRoot(env, "XDG_CONFIG_HOME", userHome, ".config"), "opencode"),
    join(xdgRoot(env, "XDG_DATA_HOME", userHome, ".local/share"), "opencode"),
    join(xdgRoot(env, "XDG_CACHE_HOME", userHome, ".cache"), "opencode"),
    join(xdgRoot(env, "XDG_STATE_HOME", userHome, ".local/state"), "opencode"),
    join(env.TMPDIR?.trim() || tmpdir(), "opencode"),
    // 安装器落点；上游 config 扫描面恒含它（存在才读，不存在拒了也无害）。
    join(userHome, ".opencode"),
    // CONFIG_DIR 是"追加"语义而非替换：它在时前面几根依然有效。
    ...(env.OPENCODE_CONFIG_DIR?.trim()
      ? [resolve(env.OPENCODE_CONFIG_DIR.trim())]
      : []),
  ];
}

/**
 * 状态根里的可执行面：安装器落点（CLI 真身所在）与 cache 的 helper 落点。
 *
 * 这两处是「获批一次写」升级成「跨 turn 持久投毒」的唯一通道——ask 档下
 * 用户放行的一次 write，若能落进 `~/.opencode/bin`，下一轮就是 CLI 自己
 * 把它执行掉。状态根可写不等于**整根**可写，可执行面必须降为只读。
 *
 * 不怕撞 mkdir：CLI 模块加载即建这七个目录，而 version/models 两路探针
 * 跑在**围栏之外**且与 turn 同一套 env——真实 turn 起跑时它们早已存在，
 * 围栏内只剩读与 chdir。（真机核对：两处 bin/ 均由探针建出。）
 */
export const opencodeExecutableRoots = (
  env: NodeJS.ProcessEnv,
  userHome: string
): string[] => [
  join(userHome, ".opencode", "bin"),
  join(xdgRoot(env, "XDG_CACHE_HOME", userHome, ".cache"), "opencode", "bin"),
];

/**
 * `OPENCODE_CONFIG` 指向单个文件。自己视角只读放行该 literal——
 * 绝不把它的父目录升格为可写根，否则一个指向 `~/` 的配置就能把整个
 * 主目录变成写面。异后端视角对同一 literal 双 deny。
 */
export const opencodeSensitiveFiles = (env: NodeJS.ProcessEnv): string[] =>
  env.OPENCODE_CONFIG?.trim() ? [resolve(env.OPENCODE_CONFIG.trim())] : [];

/**
 * 内部 HTTP server 的每 turn 随机 Basic Auth。上游默认无密码即无认证，
 * 而监听面又可被用户全局 config 翻到 0.0.0.0；参数锁定只解决监听面，
 * 凭据才解决"同机其他进程能不能用"。client 与 server 读同一组 env，
 * 两侧天然一致，无需任何协调。
 */
export const serverCredentials = () => ({
  OPENCODE_SERVER_USERNAME: `ai-chat-${randomBytes(6).toString("hex")}`,
  OPENCODE_SERVER_PASSWORD: randomBytes(32).toString("hex"),
});

/* ============================================================
 * 监听面与凭据是同一件事的两半，缺一不可。
 *
 * ACP 层会在进程内先起一个 HTTP server，而它的 hostname/port/mdns 可被
 * 用户全局 config 覆盖——config 里一句 `mdns: true` 就能把它翻到
 * 0.0.0.0。上游判「是否显式」是直接扫 argv 字面量，所以这三个参数写死
 * 在这里就恒为显式、config 压不过（也因此 args 不得含 `--` 分隔符：
 * 其后的参数不计入 argv 扫描）。
 *
 * 但锁住监听面只解决"外网能不能连"，同机其他进程仍然可以。默认无密码
 * 即无认证，故每 turn 再叠一组随机 Basic Auth；client 与 server 读同一
 * 组 env，两侧天然一致。
 * ============================================================ */
const ACP_ARGS = [
  "acp",
  "--hostname",
  "127.0.0.1",
  "--port",
  "0",
  "--no-mdns",
];

/* ============================================================
 * 这一注入不是加固，是两个权限档位能否成立的唯一支柱。
 *
 * 真机实测（1.18.14，dev/opencode-permission-probe.mjs）：**不注入
 * `OPENCODE_PERMISSION` 时，空配置下的 ACP turn 零审批请求，bash 与
 * edit 全部直接执行**——上游在 ACP 路径上的默认并不是 ask（上游默认表
 * 恰是 `"*": "allow"` 加三条例外，见 `agent/agent.ts` 的 defaults）。
 * 少了这一注入，UI 上写着「逐条审批」的档位会一次都不弹。
 *
 * 求值是 findLast（`permission/index.ts:28-38`）：合并后的规则数组倒序
 * 首个匹配者胜。注入经 mergeDeep 并入用户 config（`config/config.ts:547`）
 * ——**同名键在原位覆盖、新键追加末尾**。
 * ============================================================ */

type PermissionAction = "allow" | "ask" | "deny";

/* ============================================================
 * 逐键写全，而不是只写一条 `*`——这是"排在 `*` 之后的具体 allow"那个洞
 * 自己消失的地方。
 *
 * 只注入 `{"*":"ask"}` 时，用户 config 里 `{"*":"allow","bash":"allow"}`
 * 的 `bash` 从头到尾没被碰过，于是它排在我们的 `*` 之后、赢下 findLast。
 * 真机实测（ctl-old-hostile）：bash 一声不吭直接落盘。把已知键逐个写出来，
 * 每个键都在**原位**被覆盖，用户那条 allow 连位置都保不住。
 *
 * 空配置下与只写 `*` 逐字节同效（`*` 本就匹配它们全部），差别只发生在
 * 有洞的配置上——所以这不是行为变更，是把承诺补齐。
 *
 * 键全集锚点：上游 `core/src/v1/config/permission.ts` 的 InputObject。
 * 上游新增键而我们没跟，那个键退回「只受 `*` 兜底」——与今天等价，不会
 * 更糟；随 L11 升级复核对账。
 * ============================================================ */
const PERMISSION_KEYS = [
  "read",
  "edit",
  "glob",
  "grep",
  "list",
  "bash",
  "task",
  "external_directory",
  "todowrite",
  "question",
  "webfetch",
  "websearch",
  "lsp",
  "doom_loop",
  "skill",
] as const;

const everyKey = (action: PermissionAction) =>
  Object.fromEntries(PERMISSION_KEYS.map((key) => [key, action]));

/**
 * 上游默认里唯一一条「安全动作也要问」：`.env` 家族（模式逐字取自
 * `agent/agent.ts` 的 defaults）。approve-for-me 的 `"*": "allow"` 排在
 * 上游默认之后，会把它整条压掉——所以必须自己抄回来。
 */
const DOTENV_GUARD: Record<string, PermissionAction> = {
  "*": "allow",
  "*.env": "ask",
  "*.env.*": "ask",
  "*.env.example": "allow",
};

/**
 * Plan（`planMode: true`）由宿主表达：composer 开关经 `modeValues` 切
 * build/plan agent，再叠下方 PLAN_OVERLAY 堵住权限面。上游 ACP builtins
 * 尚未移植 plan_exit，且 build agent 默认允许模型自己 `plan_enter`——
 * 让它自己进出，等于在宿主背后扳一个 UI 上写着别的状态的开关：自己进去，
 * 编辑全被拒而开关没亮 Plan；自己出来，开关还亮着 Plan 它却已在改代码。
 * deny 让这两个工具从模型的工具表里直接消失（上游 `disabled()`：末条匹配
 * 规则是 `*`+deny 即隐藏），比放一个只会失败的工具在那里诚实。
 */
const PLAN_LOCK: Record<string, PermissionAction> = {
  plan_enter: "deny",
  plan_exit: "deny",
};

/**
 * Plan 档只改两个键，因为 Plan 只承诺一件事：**不改代码**。
 *
 * 它必须叠在权限表这一层，而不能只靠切 `mode=plan` 了事——上游把
 * `config.permission`（= 我们注入的那份）合并在 **plan agent 自己的规则之后**，
 * 所以 approve-for-me 的 `edit:"allow"` 会反过来把 plan 的 `edit:"*":"deny"`
 * 压掉。不叠这一层，「Plan + 放行安全动作」就等于 plan 形同虚设。
 *
 * `edit: deny` 而非 ask：deny 让 edit/write/patch 从模型的工具表里整个消失
 * （上游 `disabled()`），模型压根不会提议改文件，而不是提议了再被拒。
 * `bash: ask` 是同一件事的另一半——一句 `printf > file` 就能绕开 edit，
 * approve-for-me 下也必须停下来问。
 */
const PLAN_OVERLAY: Record<string, PermissionAction> = {
  edit: "deny",
  bash: "ask",
};

/**
 * `*` 恒排最前：它是兜底，排在它之后的具体键才是压过用户配置的那一手。
 * 其余键彼此不相交（没有任何键的通配能匹配另一个键），位置无所谓——
 * Plan 叠加同理：`edit`/`bash` 在基表里已有，覆盖发生在**原位**。
 *
 * approve-for-me 的"安全"边界由**围栏**定义而非由工具名定义：turn 恒跑在
 * seatbelt 里、写面 deny-by-default，所以 bash/edit 在工作区内放行是安全的
 * ——与 claude/codex 两家同档位的语义一致。真正走出这个前提的只有三条：
 * 走出工作区（external_directory）、失控循环（doom_loop）、读 `.env`。
 */
const permissionBaseline = (session: {
  approveForMe?: boolean;
  planMode?: boolean;
}) =>
  JSON.stringify({
    ...(session.approveForMe
      ? {
          "*": "allow",
          ...everyKey("allow"),
          external_directory: "ask",
          doom_loop: "ask",
          read: DOTENV_GUARD,
          ...PLAN_LOCK,
        }
      : { "*": "ask", ...everyKey("ask"), ...PLAN_LOCK }),
    ...(session.planMode ? PLAN_OVERLAY : {}),
  });

/**
 * ACP 进程启动三元组——本接入案的安全不变量全在这一份里：锁定的监听
 * 参数、权限基线、每 turn 随机凭据。`createTurn` 与 readiness 探测都必须
 * 消费它，谁也不许照抄一遍；两份必然漂移，而漂移的那一份正是安全基线。
 *
 * 档位经 `overlay.session` 进来（与 codex 同一格数据）：审批档决定基表、
 * Plan 档再叠一层。readiness 探测恒缺席这一格 ⇒ 落最严的 ask——握手不跑
 * turn，宽松没有任何收益，而 fail-closed 是这一路的默认姿势。
 *
 * 放在 home.ts 而非 descriptor：环境、凭据与启动方式本就是同一件事，
 * 且这样 index↔auth 不成环。
 */
export const opencodeAcpLaunch: AcpLauncher = (runtime, overlay) => ({
  command: runtime.executable,
  args: ACP_ARGS,
  env: {
    ...opencodeEnvironment(runtime),
    ...overlay?.processEnv,
    /* ============================================================
     * 不变量后置。此前这几条排在 `overlay` **之前**，于是"权限基线不可
     * 被覆盖"这件事全靠另一个模块的纪律——app-config-store 只放行
     * `APP_CONFIG_` 前缀的变量——一条跨模块的隐式不变量，本地零防线。
     * 隐式不变量的问题不是它今天不成立，而是它在另一个文件里被改掉时，
     * 这里不会有任何反应。挪到后面，它就成了本地的、结构上的事实。
     * ============================================================ */
    ...OVERRIDES,
    OPENCODE_PERMISSION: permissionBaseline(overlay?.session ?? {}),
    ...(overlay?.session?.thirdPartyMcpPlan?.entries.length
      ? {
          OPENCODE_CONFIG_CONTENT: opencodeMcpOverlay(
            overlay.session.thirdPartyMcpPlan
          ),
        }
      : {}),
    ...serverCredentials(),
  },
});

export function opencodeMcpOverlay(plan: ThirdPartyMcpPlan) {
  assertUniqueMcpBackendAliases(plan.entries);
  const serialized = JSON.stringify({
    mcp: Object.fromEntries(
      plan.entries.map((server) => [
        server.backendAlias,
        server.transport === "stdio"
          ? {
              type: "local",
              command: [server.command, ...server.args],
              environment: server.env,
              ...(server.cwd ? { cwd: server.cwd } : {}),
              enabled: true,
            }
          : {
              type: "remote",
              url: server.url,
              headers: server.headers,
              enabled: true,
            },
      ])
    ),
  });
  if (Buffer.byteLength(serialized, "utf8") > 96 * 1024) {
    throw new Error("OpenCode MCP overlay 超过安全的环境字节预算");
  }
  return serialized;
}
