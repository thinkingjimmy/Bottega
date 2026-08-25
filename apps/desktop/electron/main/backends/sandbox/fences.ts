/**
 * [INPUT]: Depends on Node fs/os/path, shared Back end group with back end state root analysis
 * [OUTPUT]: Provides a fence declaration table: seatbeltOwned Determination, containing a global instruction symlink True ownRoots/ownFiles/ownReadOnlyRoots (env) by subprocess with foreignSensitive (default)
 * [POS]: The truth about the sandbox path; seatbelt.ts is just a SBPL translation, and doesn't recognize any CLI directory layout
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import {
  AGENT_BACKEND_ORDER,
  type AgentBackendId,
} from "../../../../shared/agent-ipc";
import { resolveKimiCodeHome } from "../kimi/home";
import {
  opencodeExecutableRoots,
  opencodeConfigDir,
  opencodeRoots,
  opencodeSensitiveFiles,
} from "../opencode/home";

/**
 * 与后端无关的密钥面：任何后端的围栏都拒读拒写。
 * 后端自己的状态根不在这里——那是声明表的事，写在这里会误伤自己
 * （Codex 的 job 读不到 `~/.codex`，表征是 `Not logged in`）。
 */
const SHARED_SENSITIVE_HOME_PATHS = [
  ".agent",
  ".aws",
  ".azure",
  ".config/gcloud",
  ".docker",
  ".gnupg",
  ".kube",
  ".ssh",
  "Library/Keychains",
  /* 下面三个是单文件而非目录，但同样装着可直接用的 token
     （`.npmrc` 的 `_authToken`、`.netrc` 的明文口令、git 凭据缓存）。
     发射端对目录与文件用同一种规则，故不必为它们分出第二张表。 */
  ".git-credentials",
  ".netrc",
  ".npmrc",
] as const;

export type FenceScope = {
  /** 解析路径所依据的环境：自己视角传子进程 env，异后端视角传宿主快照。 */
  env: NodeJS.ProcessEnv;
  userHome: string;
};

type BackendFence = {
  /** 该后端的状态根：自己视角=可写根，异后端视角=双 deny 根。 */
  roots(scope: FenceScope): string[];
  /** 单文件敏感项：自己视角只读 literal（父目录不升格），异后端视角双 deny。 */
  files?(scope: FenceScope): string[];
  /**
   * 状态根中的**可执行面**：自己视角降为只读（读放行 + 写后置 deny），
   * 异后端视角本就落在 roots 之内，无须重复声明。
   *
   * 「自有根」不等于「可写根」——CLI 二进制与它下载的 helper 都躺在状态
   * 根里，全根放写等于把「获批一次写操作」升级成「跨 turn 持久投毒」：
   * 往自己家 bin/ 落一个文件，下一轮那家 CLI 亲手把它执行掉。
   */
  readOnlyRoots?(scope: FenceScope): string[];
  /**
   * 原生围栏后端只以 foreign 身份参与：seatbelt 不接受它的 own 声明，
   * 但它的凭据根照样进别人家的拒读名单。
   */
  seatbeltOwned: boolean;
};

/** Codex 状态根：`CODEX_HOME` 优先，否则子进程 HOME 下的 `.codex`。 */
export function codexHome(
  env: NodeJS.ProcessEnv = process.env,
  userHome = homedir()
) {
  return resolve(
    env.CODEX_HOME?.trim() || join(env.HOME?.trim() || userHome, ".codex")
  );
}

const canonicalInstructionFile = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    /* 文件尚未创建时保留 lexical 目标；保存或 symlink 改向后，下一 turn
       会重新求值并拿到新的 canonical vnode。 */
    return path;
  }
};

const FENCES: Record<AgentBackendId, BackendFence> = {
  codex: {
    seatbeltOwned: true,
    roots: ({ env, userHome }) => [codexHome(env, userHome)],
    files: ({ env, userHome }) => [
      canonicalInstructionFile(join(codexHome(env, userHome), "AGENTS.md")),
    ],
  },
  claude: {
    // 原生 sandbox settings 执行围栏；seatbelt 对它的根硬拒绝。
    seatbeltOwned: false,
    roots: ({ userHome }) => [join(userHome, ".claude")],
    files: ({ userHome }) => [
      canonicalInstructionFile(join(userHome, ".claude", "CLAUDE.md")),
    ],
  },
  kimi: {
    seatbeltOwned: true,
    roots: ({ env, userHome }) => [resolveKimiCodeHome(env, userHome)],
    files: ({ env, userHome }) => [
      canonicalInstructionFile(
        join(resolveKimiCodeHome(env, userHome), "AGENTS.md")
      ),
      /* Kimi 的通用指令位在真实 OS HOME（不随 KIMI_CODE_HOME 漂移），CLI
         对品牌位是「追加」收集。不放行的话产品会话读不到它，Settings 的
         kimi-generic-present 提示就成了只对终端为真的话。 */
      canonicalInstructionFile(join(userHome, ".agents", "AGENTS.md")),
      canonicalInstructionFile(join(userHome, ".agents", "agents.md")),
    ],
  },
  opencode: {
    seatbeltOwned: true,
    roots: ({ env, userHome }) => opencodeRoots(env, userHome),
    files: ({ env, userHome }) => [
      ...opencodeSensitiveFiles(env),
      canonicalInstructionFile(join(opencodeConfigDir(env, userHome), "AGENTS.md")),
    ],
    readOnlyRoots: ({ env, userHome }) => opencodeExecutableRoots(env, userHome),
  },
};

/** 空环境解析出的是各家默认位置——异后端名单的另一半。 */
const DEFAULT_ENV: NodeJS.ProcessEnv = {};

export const seatbeltOwned = (backend: AgentBackendId) =>
  FENCES[backend].seatbeltOwned;

export function assertSeatbeltOwned(backend: AgentBackendId) {
  if (!FENCES[backend].seatbeltOwned) {
    throw new Error(`${backend} 走原生围栏，不接受 seatbelt 自有根声明`);
  }
}

/** 本后端自己的可写状态根（凭据、会话、缓存、临时），按子进程实际 env 解析。 */
export function ownRoots(backend: AgentBackendId, scope: FenceScope) {
  assertSeatbeltOwned(backend);
  return FENCES[backend].roots(scope);
}

/** 本后端自己的只读单文件；父目录一律不升格为写根。 */
export function ownFiles(backend: AgentBackendId, scope: FenceScope) {
  assertSeatbeltOwned(backend);
  return FENCES[backend].files?.(scope) ?? [];
}

/** 本后端状态根中降为只读的可执行面：读放行，写在 allow 之后被 deny 压回。 */
export function ownReadOnlyRoots(backend: AgentBackendId, scope: FenceScope) {
  assertSeatbeltOwned(backend);
  return FENCES[backend].readOnlyRoots?.(scope) ?? [];
}

/**
 * 异后端敏感面 = 通用密钥根 ∪ 其余后端的（当前 override ∪ 默认位置）。
 *
 * 两个位置都要拒：用户把 XDG 改了，旧目录里的凭据并不会自己消失；
 * 只拒当前位置等于给"改一次环境变量就能读到别人旧凭据"留门。
 *
 * backend 缺省（undefined）时谁都不豁免——最严解释，用于无归属的围栏。
 */
export function foreignSensitive(
  backend: AgentBackendId | undefined,
  scope: FenceScope
) {
  const others = AGENT_BACKEND_ORDER.filter((id) => id !== backend);
  const spread = (pick: (fence: BackendFence) => ((s: FenceScope) => string[]) | undefined) =>
    others.flatMap((id) => {
      const resolver = pick(FENCES[id]);
      if (!resolver) return [];
      return [
        ...resolver(scope),
        ...resolver({ env: DEFAULT_ENV, userHome: scope.userHome }),
      ];
    });
  return {
    roots: [
      ...SHARED_SENSITIVE_HOME_PATHS.map((path) =>
        resolve(scope.userHome, path)
      ),
      ...spread((fence) => fence.roots),
    ],
    files: spread((fence) => fence.files),
  };
}
