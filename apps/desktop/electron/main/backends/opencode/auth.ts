/**
 * [INPUT]: Depends on shared ACP readiness kernel, opencode AcpLauncher and its exclusive failure classification
 * [OUTPUT]: Provides opencodeReadinessSpec (the launch half) and createOpencodeAuthCheck
 * [POS]: Declares only what a successful handshake proves for OpenCode: process/protocol health, not login state — auth status stays honestly unknown otherwise
 */

import {
  createAcpReadinessCheck,
  type AcpReadinessSpec,
} from "../acp/startup/readiness";
import { opencodeClassifyFailure } from "./failure";
import { opencodeAcpLaunch, validateOpencodeSessionId } from "./home";

/* ============================================================
 * `proves: "handshake"` —— 这一格数据是本文件存在的全部理由。
 *
 * OpenCode 未登录时 session/new 照样能走完：ProviderAuthError 只在 prompt
 * 终态路径才浮出来（见 index.ts 的 opencodeClassifyFailure 注释）。所以
 * 握手成功**证明不了登录**，只能证明「装对了、协议通、进程起得来」。
 *
 * 那这个检查的价值在哪？在于把「装了但根本起不来」从 unknown 这个垃圾桶里
 * 择出来变成 error。此前 OpenCode 没有 auth 扩展，两种状态混在一起，
 * 用户看到的都是「未知」。
 *
 * 凭据主权：全程只说 ACP，不碰 auth.json。
 * ============================================================ */
export const opencodeReadinessSpec: Omit<AcpReadinessSpec, "classifyFailure"> = {
  backend: "opencode",
  launch: opencodeAcpLaunch,
  validateSessionId: validateOpencodeSessionId,
  proves: "handshake",
  // 进程内还要起一个 HTTP server，比裸 CLI 慢，给足余量
  timeoutMs: 20_000,
};

export const createOpencodeAuthCheck = () =>
  createAcpReadinessCheck({
    ...opencodeReadinessSpec,
    classifyFailure: opencodeClassifyFailure,
  });
