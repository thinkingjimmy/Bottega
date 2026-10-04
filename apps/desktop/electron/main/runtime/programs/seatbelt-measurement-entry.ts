/**
 * [INPUT]: Depends on node:fs; argv is the file to read and the file to write.
 * [OUTPUT]: The seatbelt-measurement entry: reads one workspace file and writes another, printing `read:<OK|code> write:<OK|code>`.
 * [POS]: Built self-contained to out/main/seatbelt-measurement-entry.js; providers/measurements/codex-read-only.ts runs it on the bundled Node inside the Seatbelt profile a Codex turn gets (TASK-35 C11).
 */
import { readFileSync, writeFileSync } from "node:fs";

const [source, target] = process.argv.slice(2);
const attempt = (name: string, act: () => void) => {
  try { act(); return `${name}:OK`; } catch (cause) { return `${name}:${(cause as NodeJS.ErrnoException).code ?? "ERROR"}`; }
};
process.stdout.write(`${attempt("read", () => readFileSync(source!, "utf8"))} ${attempt("write", () => writeFileSync(target!, "x"))}\n`);
