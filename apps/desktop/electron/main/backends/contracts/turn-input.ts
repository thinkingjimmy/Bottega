/**
 * [INPUT]: Receives materialized text, image bytes and authorized resource references.
 * [OUTPUT]: Exports ProviderTurnInput, the product-owned Send and Steer input union.
 * [POS]: Protocol-independent input contract; ACP and native drivers convert it at their boundaries.
 */
export type ProviderTurnInput =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "resource_link"; uri: string; name: string; resourceKind?: "skill"; description?: string };
