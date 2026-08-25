/**
 * [INPUT]: Depends on shared/agent-ipc's BackendInfo, shared/settings-ipc's ChatHomeState and canEnterAgentBackend for agent-backends
 * [OUTPUT]: Provides ONBOARDING_REQUIREMENTS, chatHomeRequirement/agentRequirement The fact that projection and loading/onboarding/app tri-state judgments (the absence of gaps is guided, no exemption); The last file of the caller that was not delivered at the time
 * [POS]: The only determination of the renderer's direction of start; SetupProvider's entry gateway and OnboardingView are the same as the steps of reading a conclusion.The gap is guided, no exemption file
 */

import type { BackendInfo } from "../../shared/agent-ipc";
import type { ChatHomeState } from "../../shared/settings-ipc";
import { canEnterAgentBackend } from "./agent-backends";

/* ============================================================
 * 完成条件是一份清单，不是散落两处的两个布尔。
 *
 * 判据此前有两个副本：进入门只看 Agent，页面里的缺口清单看双门槛。
 * 于是「Agent 已就绪但没选数据位置」根本不会被引导拦下——两个副本
 * 各自都对，拼起来漏了一整类状态。
 *
 * 数组顺序即步骤顺序即缺口顺序。新增一条门槛只改这里，进入门、
 * 步骤徽章与兜底横幅自动跟上，没有第二处判据可以走偏。
 * ============================================================ */
export const ONBOARDING_REQUIREMENTS = ["chat-home", "agent"] as const;

export type OnboardingRequirementId = (typeof ONBOARDING_REQUIREMENTS)[number];

/** 三态而非布尔：「还没查明白」不是「没配好」，混成一个值首帧必闪引导。 */
export type RequirementStatus = "satisfied" | "missing" | "unknown";

export type OnboardingFacts = Record<OnboardingRequirementId, RequirementStatus>;

export type OnboardingPhase = "loading" | "onboarding" | "app";

export type OnboardingVerdict = {
  phase: OnboardingPhase;
  facts: OnboardingFacts;
  /** 确凿缺失项，按 ONBOARDING_REQUIREMENTS 顺序。 */
  missing: OnboardingRequirementId[];
  /** 事实已落定：判决可以写回缓存，兜底横幅也才有资格开口。 */
  settled: boolean;
};

/* 读不出设置与读出「未选目录」在产品上是同一件事：都开不了工。
   区别只在引导页内——错误由 ChatHomeCard 自陈并给重试入口。 */
export const chatHomeRequirement = (
  state: ChatHomeState | null,
  error: string
): RequirementStatus => {
  if (state) return state === "ready" ? "satisfied" : "missing";
  return error ? "missing" : "unknown";
};

/* 入场判据仍由 canEnterAgentBackend 独占。肯定与否定不对称：任一后端
   可入场即 satisfied，不必等扫描收尾；missing 却必须以收齐的证据为前提
   ——全量检测在飞（checking）或任一后端 auth 还在探（"checking" 瞬态）
   时，看不见可入场者只是「还不知道」。此前 backends 一旦非空就短路
   checking，流式先到的部分快照被当成全量结论，首启因此闪引导。 */
export const agentRequirement = (
  backends: readonly BackendInfo[] | null,
  checking: boolean
): RequirementStatus => {
  if (backends?.some(canEnterAgentBackend)) return "satisfied";
  const pending =
    checking ||
    Boolean(backends?.some((entry) => entry.authStatus === "checking"));
  return pending ? "unknown" : "missing";
};

export function onboardingGate({
  facts,
  forced,
  held = "loading",
}: {
  facts: OnboardingFacts;
  /** 从聊天/App 入口显式召唤引导，压过一切。 */
  forced: boolean;
  /** 上一次已呈现的档位。事实未落定时守住它：复检把唯一后端打回
      auth 瞬态时，正在显示的 app/onboarding 不得闪回 loading。
      启动期没有上一档，缺省即 loading。 */
  held?: OnboardingPhase;
}): OnboardingVerdict {
  const missing = ONBOARDING_REQUIREMENTS.filter(
    (id) => facts[id] === "missing"
  );
  /* 已有确凿缺口就不必等其余：无论它们如何，引导都得出场。
     这一步换来的是首次启动零闪——缺口最先到达的那一刻就判决。 */
  const settled =
    missing.length > 0 ||
    ONBOARDING_REQUIREMENTS.every((id) => facts[id] === "satisfied");
  const decide = (): OnboardingPhase => {
    if (forced) return "onboarding";
    if (!settled) return held;
    /* 没有豁免这一档：两个门槛没补齐就是进不去。从前这里还问一句
       「用户按过稍后配置没有」，而那颗按钮连同它背后的记号已经一并撤销
       ——留着一个只有 devtools 够得着的旁路，等于门没关严。 */
    return missing.length > 0 ? "onboarding" : "app";
  };
  return { phase: decide(), facts, missing, settled };
}
