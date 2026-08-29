/**
 * [INPUT]: Depends on the canonical Agent backend identity
 * [OUTPUT]: Provides ProductResourceScope, TurnProjectContext, ScopedResourceVersion, and localizable renderer-safe backend support facts shared by Tools, Extensions, Skills, and Apps
 * [POS]: Neutral shared vocabulary for Product-owned global/Project resources; domain contracts import these types instead of copying scope shapes
 */

import type { AgentBackendId } from "./agent-ipc";
export type {
  ProductResourceScope,
  ScopedResourceVersion,
  TurnProjectContext,
} from "./product-resource-scope";

export type ResourceBackendUnsupportedReason =
  | "runtime-unavailable"
  | "builtin-tools-unsupported"
  | "transport-unsupported"
  | "turn-origin-unsupported"
  | "plan-mode-unsupported"
  | "security-policy"
  | "unknown";

export type ResourceBackendSupportView = Readonly<{
  backendId: AgentBackendId;
  supported: boolean;
  reason: ResourceBackendUnsupportedReason | null;
  /** External runtime diagnostics remain untranslated and optional. */
  detail?: string;
  /** Product-owned constraints stay structured so every renderer locale owns its prose. */
  constraint?: Readonly<{
    kind: "minimum-runtime-version";
    minimumVersion: string;
    detectedVersion: string | null;
  }>;
}>;

export type EffectiveResourceState = "enabled" | "disabled" | "unavailable";
