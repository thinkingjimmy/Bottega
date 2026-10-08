/**
 * [INPUT]: Shared composer queue and encrypted checkpoint capacity requirements.
 * [OUTPUT]: LOCAL_QUEUE_LIMIT and DRAFT_CUSTODY_LIMIT for live and restored drafts.
 * [POS]: DOM-free capacity contract shared by the input store and checkpoint schema.
 */
export const LOCAL_QUEUE_LIMIT = 20;
// Include the server queue, the local queue and commands awaiting canonical bodies.
export const DRAFT_CUSTODY_LIMIT = 128;
