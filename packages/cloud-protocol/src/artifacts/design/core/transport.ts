/**
 * [INPUT]: JSON-serializable metadata.
 * [OUTPUT]: Exact UTF-8 JSON byte measurement and the shared resource command budget.
 * [POS]: Native and system transport primitives independent of any editor model.
 */
export const DESIGN_COMMAND_BYTES = 8 * 1024;
export const utf8JsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
