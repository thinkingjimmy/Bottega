/**
 * [INPUT]: Depends on the on-disk shapes of the Chat Home ledger, Purge journal, lifecycle intents and Agent custody ledger, plus the relocation database reader.
 * [OUTPUT]: Provides unfinishedWork: the reasons a folder move must wait, read from durable state before any owner is constructed.
 * [POS]: Startup admission for a move; records that are mid-flight are finished by their owners, never rewritten under them.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isErrnoCode } from "../../persistence/durable-json";
import { unfinishedSagas } from "./database";

type Json = Record<string, unknown>;
type Probe = { file: string; busy(value: Json): boolean };

const values = (value: unknown) => Object.values((value ?? {}) as Record<string, Json>);
const items = (value: unknown) => (Array.isArray(value) ? value : []) as Json[];

/* Each probe reads only the one field that says "still in flight". A file that cannot be read
   counts as busy: a move is optional, so the cautious answer costs a retry, not data. */
const PROBES: Record<string, Probe> = {
  "chat-home": { file: "chat-home-ledger.json",
    busy: value => values(value.chats).some(record => ["planned", "materialized", "prepared", "rollingBack"].includes(String(record.phase))) },
  purge: { file: "chat-purge-journal.json", busy: value => values(value.intents).some(intent => intent.phase !== "completed") },
  lifecycle: { file: join("lifecycle", "intents.json"), busy: value => items(value.intents).length > 0 },
  custody: { file: join("agent-custody", "turns.json"), busy: value => items(value.entries).some(entry => entry.phase !== "released") },
};

export async function unfinishedWork(userData: string): Promise<string[]> {
  const reasons: string[] = [];
  for (const [name, probe] of Object.entries(PROBES)) {
    try { if (probe.busy(JSON.parse(await readFile(join(userData, probe.file), "utf8")) as Json)) reasons.push(name); }
    catch (error) { if (!isErrnoCode(error, "ENOENT")) reasons.push(`${name}-unreadable`); }
  }
  try { if (await unfinishedSagas(userData)) reasons.push("continuation"); }
  catch { reasons.push("continuation-unreadable"); }
  return reasons;
}
