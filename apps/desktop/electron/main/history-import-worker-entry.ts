/**
 * [INPUT]: Depends on the dedicated history import worker runtime
 * [OUTPUT]: Starts the packaged read-only external-history parser worker entry
 * [POS]: Build-stable utility entry; parsing and backpressure remain inside history-import/import-worker
 */

import "./history-import/import-worker/worker";
