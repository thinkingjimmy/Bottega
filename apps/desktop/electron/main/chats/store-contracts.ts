/**
 * [INPUT]: Node SHA-256, session references and the SQLite database client contract.
 * [OUTPUT]: ChatStoreDependencies, ChatSqliteRuntimeFacts, sessionKey, requestHash.
 * [POS]: Chat store dependencies, runtime facts and deterministic identities; the store owns persistence.
 */
import { createHash } from "node:crypto";
import type { SessionRef } from "../../../shared/ipc/agent/agent-ipc";
import { ChatDatabaseClient } from "./sqlite/database-client";

export type ChatStoreDependencies = {
  storageMode?: import("../../../shared/local-storage/contracts").RuntimeStorageMode;
  now?: () => number;
  isAppProject?: (projectId: string) => boolean;
  appForProject?: (projectId: string) =>
    | { appId: string; editableSource: boolean }
    | null;
  databaseClient?: () => ChatDatabaseClient;
};

export type ChatSqliteRuntimeFacts = Readonly<{
  sqliteVersion: string;
  compileOptions: readonly string[];
  startupMs: number;
}>;

export const sessionKey = (session: SessionRef) =>
  `${session.backend}:${session.id}`;

export const requestHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
