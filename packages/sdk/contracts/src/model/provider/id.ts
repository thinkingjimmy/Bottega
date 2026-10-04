/**
 * [INPUT]: No runtime dependencies.
 * [OUTPUT]: The bounded ProviderId type, PROVIDER_ID_PATTERN and isProviderId guard.
 * [POS]: Dependency-free Provider identity; descriptor and wire schemas share this grammar.
 */
export const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
export type ProviderId = string;
export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDER_ID_PATTERN.test(value);
}
