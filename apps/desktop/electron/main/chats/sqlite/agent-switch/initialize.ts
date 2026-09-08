/**
 * [INPUT]: Depends on SQLite transactions and validated backend defaults
 * [OUTPUT]: Fills missing Chat options atomically before startup recovery and metadata publication
 * [POS]: Startup-only initialization; existing canonical choices are never overwritten
 */

import type { SqliteDatabase } from "../connection";
import { transaction } from "../connection";
import { backendDefaults, defaultsSchema } from "../../../../../shared/chat-agent/options";
import type { DefaultChatOptionsByBackend } from "../../../../../shared/settings-ipc";
import type { AgentBackendId } from "../../../../../shared/agent-ipc";

export function initializeChatOptions(database: SqliteDatabase, input: DefaultChatOptionsByBackend = {}) {
  const defaults = defaultsSchema.parse(input);
  transaction(database, () => {
    const rows = database.prepare("SELECT DISTINCT agent FROM chats WHERE options_json IS NULL").all() as { agent: AgentBackendId }[];
    const update = database.prepare("UPDATE chats SET options_json = ? WHERE agent = ? AND options_json IS NULL");
    for (const { agent } of rows) update.run(JSON.stringify(backendDefaults(defaults, agent)), agent);
  });
}
