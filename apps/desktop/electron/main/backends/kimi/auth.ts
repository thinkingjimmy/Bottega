/**
 * [INPUT]: Depends on shared ACP readiness kernel, Kimi Acp Launcher and declaration source read-only disposable readiness home
 * [OUTPUT]: Provides kimiReadinessSpec (credential-safe: disposable state root, network-less Seatbelt) and createKimiAuthCheck
 * [POS]: Declares only what a successful handshake proves for Kimi; the entire check mechanism is delegated to acp/startup readiness
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
  /* 探针只在 createDisposableKimiHome 的一次性根里跑，真实状态根以只读 symlink 暴露，
     外层 Seatbelt 还关掉了网络：它既刷新不了 token 也写不回配置，因此可以与额度读取
     并行，不必独占凭据。 */
  credentialSafe: true,
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
