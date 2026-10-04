/**
 * [INPUT]: None.
 * [OUTPUT]: Provides BASE_OWNER_KEY_PATTERN and BaseOwnerKey, the grammar of a Base owner key (`chat:<id>` or `project:<id>`).
 * [POS]: Contract-owned so the dependency runs one way: consumers (the Base model among them) import the grammar from here, and contracts import nothing private.
 */
export const BASE_OWNER_KEY_PATTERN = /^(?:chat|project):[A-Za-z0-9_-]{1,128}$/;
export type BaseOwnerKey = `chat:${string}` | `project:${string}`;
