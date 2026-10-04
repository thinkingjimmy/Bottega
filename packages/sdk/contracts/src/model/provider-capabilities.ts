/**
 * [INPUT]: None (a type-only reference to the descriptor)
 * [OUTPUT]: Provides PROVIDER_CAPABILITIES, PROVIDER_PURPOSES, APPLIES_AT (with their types) and providersDeclaring, re-exported unchanged by provider.ts
 * [POS]: The zod-free leaf of the Provider contract: code that only needs the capability names and the declaring filter (the provider bridge's tool schemas) imports this without evaluating the descriptor schemas
 */
import type { ProviderDescriptor } from "./provider";

export const PROVIDER_CAPABILITIES = ["resume", "steer", "cancel", "plan-mode", "structured-report", "permission-request",
  "tool-filter", "read-only", "network-off", "mcp-stdio", "mcp-http", "mcp-sse", "image-input", "model-catalog", "quota",
  "history-import",
  /* Product-policy bits: which built-in tools may assign work to this provider. Tool schemas derive their provider
     enums from these, so opening the id never silently widens an assignment surface. */
  "section-assign", "subagent-assign", "project-convert"] as const;
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];
export const PROVIDER_PURPOSES = ["chat", "title", "format-extract", "install-analysis", "repair", "serve", "subagent"] as const;
export type ProviderPurpose = (typeof PROVIDER_PURPOSES)[number];
/** When a config field takes effect. `process-start` values are part of the process (and pool) identity. */
export const APPLIES_AT = ["next-turn", "session-create", "process-start"] as const;
export type AppliesAt = (typeof APPLIES_AT)[number];

/** Providers whose static descriptor does not rule the capability out, in the given order. */
export function providersDeclaring(descriptors: readonly ProviderDescriptor[], capability: ProviderCapability) {
  return descriptors.filter(descriptor => descriptor.capabilities[capability] === "declared").map(descriptor => descriptor.providerId);
}
