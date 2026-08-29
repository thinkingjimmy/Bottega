/**
 * [INPUT]: Depends only on a NodeJS platform identifier
 * [OUTPUT]: Provides the immutable 0.1.0 platform-support matrix, the single refusal message, and fail-closed capability assertions
 * [POS]: Single product-policy truth for macOS first-class and Windows/Linux preview boundaries
 */

export type PlatformCapabilityId =
  | "agentTurns"
  | "headlessSandbox"
  | "ownedGitMutation"
  | "serverApps"
  | "chromeImport"
  | "memory";

export type PlatformCapabilities = Readonly<{
  tier: "first-class" | "preview";
  capabilities: Readonly<Record<PlatformCapabilityId, boolean>>;
}>;

const DARWIN_CAPABILITIES: PlatformCapabilities = Object.freeze({
  tier: "first-class",
  capabilities: Object.freeze({
    agentTurns: true,
    headlessSandbox: true,
    ownedGitMutation: true,
    serverApps: true,
    chromeImport: true,
    memory: true,
  }),
});

const PREVIEW_CAPABILITIES: PlatformCapabilities = Object.freeze({
  tier: "preview",
  capabilities: Object.freeze({
    /* 0.1.0 deliberately refuses partial custody: Windows lacks the ps birth
       identity/process-tree contract and Linux lacks the product seatbelt. */
    agentTurns: false,
    headlessSandbox: false,
    ownedGitMutation: false,
    serverApps: false,
    chromeImport: false,
    memory: false,
  }),
});

export const resolvePlatformCapabilities = (
  platform: NodeJS.Platform
): PlatformCapabilities =>
  platform === "darwin" ? DARWIN_CAPABILITIES : PREVIEW_CAPABILITIES;

/* 拒绝辞令只有这一处。谁手抄一遍，谁就在下次改口径时留下一句旧话。 */
export const platformCapabilityUnavailable = (
  capability: PlatformCapabilityId
) =>
  new Error(
    `PLATFORM_CAPABILITY_UNAVAILABLE: ${capability} is disabled in the 0.1.0 preview`
  );

export function assertPlatformCapability(
  support: PlatformCapabilities,
  capability: PlatformCapabilityId
) {
  if (!support.capabilities[capability]) {
    throw platformCapabilityUnavailable(capability);
  }
}
