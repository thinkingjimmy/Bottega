/**
 * [INPUT]: Depends on shared ACP readiness kernel, Kimi Acp Launcher and declaration source read-only disposable readiness home
 * [OUTPUT]: Provides kimiReadinessSpec and createKimiAuthCheck
 * [POS]: The following are the results of the test: Just say "shake hands prove what", and the whole mechanism is startup/readiness
 */

import {
  createAcpReadinessCheck,
  type AcpReadinessSpec,
} from "../acp/startup/readiness";
import {
  createDisposableKimiHome,
  kimiAcpLaunch,
  validateKimiSessionId,
} from "./home";

/**
 * `proves: "auth"` —— Kimi 未登录时 session/new 会以结构化 auth 错误失败，
 * 所以握手成功确实证明了登录态（2026-07-29 真机取证）。
 */
export const kimiReadinessSpec: AcpReadinessSpec = {
  backend: "kimi",
  launch: kimiAcpLaunch,
  validateSessionId: validateKimiSessionId,
  proves: "auth",
  timeoutMs: 12_000,
  async prepareProcessEnvironment() {
    const home = await createDisposableKimiHome();
    return {
      /* readiness 不运行用户 Skill；HOME 与 KIMI_CODE_HOME 共用临时根，
         避免 Kimi 为 ~/.agents/skills 建立大量 watcher 后以 EMFILE 退出。 */
      processEnv: {
        HOME: home.path,
        KIMI_CODE_HOME: home.path,
        /* Kimi 0.34 的 SEA native cache 默认落 HOME；独立出去，避免把
           cache 变动塞进递归 watch 的 readiness state 根。 */
        KIMI_CODE_CACHE_DIR: home.cachePath,
      },
      readOnlyRoots: home.readOnlyRoots,
      release: () => home.release(),
    };
  },
};

export const createKimiAuthCheck = () =>
  createAcpReadinessCheck(kimiReadinessSpec);
