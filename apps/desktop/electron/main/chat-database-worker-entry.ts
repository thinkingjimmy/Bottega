/**
 * [INPUT]: Depends on worker_threads parentPort and the Chat SQLite worker dispatcher
 * [OUTPUT]: Starts the packaged dedicated Chat database worker entry
 * [POS]: Build-stable utility entry; business behavior remains inside chats/sqlite
 */

import "./chats/sqlite/database-worker";
