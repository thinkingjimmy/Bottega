/**
 * [INPUT]: Depends on canonical Chat worker command names.
 * [OUTPUT]: Identifies business commits requiring portable coverage and retained custody before acknowledgement.
 * [POS]: Pure incremental delivery discriminator shared by main and the SQLite worker.
 */
export const businessOutboxKinds = new Set(["upsert-record", "update-chat-facts", "update-readonly-presentation", "append-message", "commit-turn",
  "reserve-turn-sequences", "reserve-switch-sequences", "switch-agent", "classification-commit"]);
