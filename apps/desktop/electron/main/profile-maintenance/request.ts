/**
 * [INPUT]: Depends on the durable single-file replace primitive and the erase marker name.
 * [OUTPUT]: Provides requestErase: records that the next launch must erase this profile, and optionally retire the Bottega folder.
 * [POS]: The running app's half of profile erasure; kept apart from erase.ts so the entry files never load persistence code.
 */
import { join } from "node:path";
import { durableReplaceFile } from "../persistence/durable-json";
import { ERASE_MARKER } from "./erase";

/** `folder` is the Bottega folder to move to the Trash as well, or null to leave it where it is. */
export const requestErase = (userData: string, folder: string | null) =>
  durableReplaceFile(join(userData, ERASE_MARKER), JSON.stringify({ version: 1, folder, requestedAt: Date.now() }) + "\n");
