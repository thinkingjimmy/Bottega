/**
 * [INPUT]: type-only depends on the shared FrozenAppExtensionRequirementSetV1 and AppGenerationBinding pending shape
 * [OUTPUT]: Provides AppExtensionGenerationPort: handoff to copy, this generation consent decision and promote pre-review
 * [POS]: The only narrow port on the side of the Apps is AppX ExtensionAppStore therefore does not import any Extensions aggregate
 */

import type { AppGenerationBinding } from "../../../shared/apps-ipc";
import type { FrozenAppExtensionRequirementSetV1 } from "../../../shared/extensions-ipc";

export type AppExtensionGenerationConsent = Pick<
  NonNullable<AppGenerationBinding["pending"]>,
  "consentDecisionId" | "expectedConsentRevision" | "state"
>;

export type AppExtensionGenerationHandoff = Readonly<{
  reservationId: string;
  frozenSet: FrozenAppExtensionRequirementSetV1;
}>;

export type AppExtensionGenerationPort = Readonly<{
  /** 复制 participant 已 fsync 的 handoff；null = 尚未 prepared，AppStore 不得自行解析 */
  handoff(generationBuildId: string): AppExtensionGenerationHandoff | null;
  /** 为该代创建 stable decision：等价/缩权直接 derived，新增/扩权只写 consent-required */
  decide(input: {
    appId: string;
    frozenSet: FrozenAppExtensionRequirementSetV1;
    deriveFromGenerationId: string | null;
  }): Promise<AppExtensionGenerationConsent>;
  /** 用户同意/拒绝：两者都是终态，都在一个 GrantStore commit 内写 exact grant set */
  resolveConsent(input: {
    appId: string;
    frozenSet: FrozenAppExtensionRequirementSetV1;
    consentDecisionId: string;
    expectedConsentRevision: number;
    granted: boolean;
  }): Promise<AppExtensionGenerationConsent>;
  /** promote 前复核 decision 已终结、revision 未变且该代未被 revoke */
  promotable(input: {
    appId: string;
    appGenerationId: string;
    consentDecisionId: string;
    expectedConsentRevision: number;
  }): boolean;
}>;
