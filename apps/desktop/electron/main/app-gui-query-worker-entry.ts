/**
 * [INPUT]: Depends on the Apps Base GUI Query V1 worker loop
 * [OUTPUT]: Provides the explicit electron-vite entry used by BaseGuiQueryExecutor
 * [POS]: Main bundle utility entry; composition roots address its emitted JavaScript by a fixed filename
 */

import "./apps/base-gui/api/query-worker";
