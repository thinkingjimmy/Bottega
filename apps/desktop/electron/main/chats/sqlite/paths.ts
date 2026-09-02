/**
 * [INPUT]: Depends on node:path and the canonical userData root of one installation
 * [OUTPUT]: Provides chatDatabasePath and chatImportBlobsRoot
 * [POS]: The single naming authority for Chat SQLite artefacts; callers derive paths here instead of re-joining literals
 */

import { join } from "node:path";

export const CHAT_DATABASE_FILE = "bottega.sqlite3";

export const chatDatabasePath = (userData: string) =>
  join(userData, CHAT_DATABASE_FILE);

export const chatImportBlobsRoot = (userData: string) =>
  join(userData, "chat-import-blobs");
